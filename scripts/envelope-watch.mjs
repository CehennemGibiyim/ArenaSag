#!/usr/bin/env node
/**
 * Arena Radar — WebSocket zarf dinleyicisi.
 *
 * `room/info` çoğu odada zarf alanı döndürmüyor: TikTok sandığı/mektubu yalnızca
 * canlı akışta, oda WebSocket'ine `WebcastEnvelopeMessage` olarak düşüyor. Bu
 * modül odalara `tiktok-live-connector` ile bağlanır, zarf mesajlarını yakalar ve
 * radarın kullandığı ortak ödül biçimine çevirir.
 *
 * Kullanım (radar içinden):
 *   const watch = await watchEnvelopes({ rooms, seconds: 240 });
 *
 * Kullanım (tek başına):
 *   node scripts/envelope-watch.mjs --from web/data/arena-live.json --rooms 40 --seconds 240
 *   node scripts/envelope-watch.mjs --room 7710599307589864195:denisa_gabriela100 --seconds 120
 *
 * Bağlantı odası kimliğiyle yapılır; `user/room` ucu çağrılmaz. Tanımlıysa
 * EULER_API_KEY imzalama için kullanılır, tanımlı değilse ücretsiz imzalama
 * denenir (düşük hız sınırı).
 */

const clamp = (value, min, max) => {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
};

const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const list = (value) => (Array.isArray(value) ? value : []);
const str = (value, max = 160) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const integer = (value) => {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0;
};
const handle = (value) => {
  const clean = str(value, 40).replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,24}$/.test(clean) ? clean : "";
};
const roomKey = (value) => {
  const id = str(value, 24);
  return /^\d{10,20}$/.test(id) ? id : "";
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Zarf ailesinin bilinen TikTok mesaj tipleri. Yeni bir tip bunların dışında
 * görünürse şema sürüklenmesi uyarısı üretilir; adı tanınmayan bir aile üyesi
 * (`Envelope`, `GoodyBag`, `Letter`, `Parcel`, `Chest`) de aynı uyarıyı tetikler.
 */
export const ENVELOPE_MESSAGE_TYPES = ["WebcastEnvelopeMessage", "WebcastGoodyBagMessage"];
const ENVELOPE_TYPE_FAMILY = /envelope|goody.?bag|letter|parcel|chest/i;

/**
 * Zarf şeması takibini yayınlar arasında taşır: bu turda tip görülmediyse son
 * görülme anı ve örnek tip önceki yayından devam eder; ilk çalıştırma sessizlik
 * tabanını (`trackingSince`) kurar. Geçersiz eski değerler yok sayılır.
 */
export function envelopeSchemaState(messageTypes, previous = {}, now = Date.now()) {
  const drift = envelopeTypeDrift(messageTypes);
  const prev = obj(previous);
  const iso = (value) => {
    const parsed = Date.parse(String(value ?? ""));
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
  };
  const at = new Date(now).toISOString();
  return {
    ...drift,
    at,
    trackingSince: iso(prev.envelopeTrackingSince) || at,
    lastSeenAt: drift.types.length ? at : iso(prev.envelopeLastSeenAt),
    sampleType: drift.sampleType ?? (str(prev.envelopeSampleType, 80) || null),
  };
}

/**
 * Dinlemede görülen mesaj tiplerinden zarf ailesini ayırır: bilinen tipler ve
 * tanınmayan (şema sürüklenmesi) tipler. Örnek tip, en çok görülen aile üyesidir.
 */
export function envelopeTypeDrift(messageTypes) {
  const known = new Set(ENVELOPE_MESSAGE_TYPES.map((type) => type.toLowerCase()));
  const rows = Object.entries(obj(messageTypes))
    .map(([type, count]) => ({ type: String(type), count: Number(count) || 0 }))
    .filter((row) => row.type && row.count > 0 && ENVELOPE_TYPE_FAMILY.test(row.type))
    .sort((a, b) => b.count - a.count);
  return {
    types: rows.map((row) => row.type),
    sampleType: rows[0]?.type ?? null,
    unknown: rows.filter((row) => !known.has(row.type.toLowerCase())),
  };
}

/** Zarfın açılış zamanı saniye cinsindendir; milisaniye gelirse normalize edilir. */
function opensAtSeconds(value, now) {
  const raw = typeof value === "string" && value.trim() ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 0;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  if (ms < now - 6 * 3_600_000 || ms > now + 24 * 3_600_000) return 0;
  return Math.floor(ms / 1000);
}

function pick(source, keys) {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

/**
 * `WebcastEnvelopeMessage` (ve aynı alanları taşıyan mektup/parsel mesajları)
 * -> radarın ödül biçimi. Uydurma alan yok: kimlik, koin, kişi ve açılış
 * zamanı okunamazsa mesaj yok sayılır.
 */
export function envelopeReward(raw, fallbackRoomId = "") {
  const record = obj(raw);
  const data = obj(record.data);
  const info = obj(
    record.envelopeInfo ??
      record.envelope_info ??
      record.letterInfo ??
      record.letter_info ??
      record.parcelInfo ??
      record.parcel_info ??
      data.envelopeInfo ??
      data.envelope_info ??
      record,
  );
  const nested = obj(info.info ?? info.reward ?? info.detail);
  const read = (keys) => pick(info, keys) ?? pick(nested, keys) ?? pick(record, keys) ?? pick(data, keys);
  const now = Date.now();
  const envelopeId = str(
    read(["envelopeId", "envelope_id", "letterId", "letter_id", "parcelId", "parcel_id"]),
    80,
  );
  const coins = integer(read(["diamondCount", "diamond_count", "coins", "coinCount", "coin_count", "amount"]));
  const slots = integer(read(["peopleCount", "people_count", "slots", "slotCount", "slot_count", "count"]));
  const opensAt = opensAtSeconds(read(["unpackAt", "unpack_at", "openAt", "open_at", "expireAt", "expire_at"]), now);
  if (!envelopeId || !coins || !slots || !opensAt) return null;
  const container = str(record.type ?? record.container ?? "", 40) || "ws";
  const isLetter = /letter|parcel|mektup/i.test(container) || Boolean(record.letterInfo || record.letter_info);
  return {
    envelopeId: isLetter && !envelopeId.includes(":") ? `letter:${envelopeId}` : envelopeId,
    roomId: roomKey(read(["roomId", "room_id"])) || fallbackRoomId,
    coins,
    slots,
    opensAt,
    skinId: integer(read(["skinId", "skin_id"])) || (isLetter ? 0 : 1),
    businessType: integer(read(["businessType", "business_type"])) || 1,
    container,
  };
}

/** WebcastGoodyBagMessage -> aynı biçim (koin çantası). */
export function bagReward(raw, fallbackRoomId = "") {
  const data = obj(raw);
  const base = obj(data.baseInfo ?? data.base_info ?? obj(data.data).baseInfo);
  const common = obj(base.commonDetail ?? base.common_detail);
  const coin = obj(base.coinDetail ?? base.coin_detail);
  const bagId = str(base.goodyBagId ?? base.goody_bag_id ?? data.goodyBagId, 80);
  const coins = integer(coin.totalCoin ?? coin.total_coin ?? data.totalCoins);
  const slots = integer(common.winnerHeadcount ?? common.winner_headcount ?? data.winnerCount);
  const opensAt = opensAtSeconds(data.openAt ?? data.open_at ?? base.openAt ?? base.open_at, Date.now());
  if (integer(base.biz ?? data.biz) !== 1 || !bagId || !coins || !slots || !opensAt) return null;
  return {
    envelopeId: `bag:${bagId}`,
    roomId: roomKey(base.roomId ?? base.room_id) || fallbackRoomId,
    coins,
    slots,
    opensAt,
    skinId: 0,
    businessType: 1,
    container: "goody_bag",
  };
}

const ROOM_ENVELOPE_KEYS = [
  "envelopeInfo",
  "envelope_info",
  "envelopeList",
  "envelope_list",
  "envelope",
];
const ROOM_LETTER_KEYS = ["letterInfo", "letter_info"];
const ROOM_PARCEL_KEYS = ["parcelInfo", "parcel_info"];
const ROOM_BAG_KEYS = ["goodyBag", "goody_bag", "luckyBag", "lucky_bag"];

const roomEntries = (value) =>
  Array.isArray(value) ? value.slice(0, 20) : value && typeof value === "object" ? [value] : [];

/**
 * Bağlantı anındaki oda bilgisindeki (`room/info`) açık zarf alanlarını okur.
 * Odaya girildiğinde zaten duran sandık/mektup/çanta böylece akışı beklemeden
 * listeye girer; istek imzalama kotası harcamaz. Uydurma yok: alanlar
 * `envelopeReward`/`bagReward` ile aynı doğrulamadan geçer.
 */
export function roomEnvelopeRewards(roomData, fallbackRoomId = "") {
  const roots = [obj(roomData)];
  const nested = obj(obj(roomData).data);
  if (Object.keys(nested).length) roots.push(nested);
  const rewards = [];
  const seen = new Set();
  const add = (reward) => {
    if (!reward || seen.has(reward.envelopeId)) return;
    seen.add(reward.envelopeId);
    rewards.push(reward);
  };
  for (const root of roots) {
    for (const key of ROOM_ENVELOPE_KEYS) {
      for (const entry of roomEntries(root[key])) add(envelopeReward(entry, fallbackRoomId));
    }
    for (const key of ROOM_LETTER_KEYS) {
      for (const entry of roomEntries(root[key])) add(envelopeReward({ letterInfo: entry }, fallbackRoomId));
    }
    for (const key of ROOM_PARCEL_KEYS) {
      for (const entry of roomEntries(root[key])) add(envelopeReward({ parcelInfo: entry }, fallbackRoomId));
    }
    for (const key of ROOM_BAG_KEYS) {
      for (const entry of roomEntries(root[key])) add(bagReward(entry, fallbackRoomId));
    }
  }
  return rewards;
}

/**
 * Bir odada ne kadar kalınacağını hesaplar. `holdSeconds = 0` pencere sonuna
 * kadar beklemek demektir; kısa tutulduğunda bağlantı erken kapanır ve sıradaki
 * odaya geçilir. Pencere sınırı hiçbir zaman aşılmaz.
 */
export function connectionHoldMs(deadline, holdSeconds, now = Date.now()) {
  const remaining = Math.max(0, deadline - now);
  if (!Number.isFinite(holdSeconds) || holdSeconds <= 0) return remaining;
  return Math.min(remaining, Math.round(holdSeconds * 1000));
}

/**
 * Panelde ve `arena-live.json` içinde gösterilecek dinleme uyarıları.
 *
 * Sessiz yutma yok: dinleme kapalıysa, çalışmadıysa, imzalama anahtarı yoksa
 * veya kota dolduysa nedeni açık bir cümleyle döner.
 */
export function envelopeWarnings(
  watch,
  {
    rooms = 0,
    enabled = true,
    seconds = 0,
    apiKey = false,
    // Son zarf tipinin görüldüğü an ve o anki örnek tip; 24 saat sessizlik
    // kontrolü bu kayda dayanır (yayınlar arasında `health` alanında taşınır).
    lastSeenAt = null,
    trackingSince = null,
    sampleType = null,
    now = Date.now(),
  } = {},
) {
  if (!enabled) return ["WebSocket zarf dinleyicisi kapalı (ARENA_ENVELOPE_ROOMS=0)."];
  if (!watch) {
    return [`WebSocket zarf dinleyicisi bu turda çalışmadı (${seconds} sn dinleme penceresi yok).`];
  }
  const warnings = [];
  if (!watch.signedWithKey) {
    warnings.push(
      apiKey
        ? "EULER_API_KEY tanımlı ama imzalama anahtarsız çalıştı: ücretsiz kota uygulanıyor."
        : "EULER_API_KEY yok: WebSocket imzalaması ücretsiz kotada. Dakikada yalnızca birkaç oda bağlanır; " +
            `${rooms} odanın tamamı dinlenemez. Anahtar eklenince tüm odalar dinlenir.`,
    );
  }
  if (watch.rateLimited) {
    warnings.push(
      `İmzalama kotası doldu (${watch.rateLimitHits ?? 0} bağlantı reddedildi); dinleme durdu. ` +
        (watch.signedWithKey ? "EulerStream plan/kotası yükseltilmeli." : "EULER_API_KEY ekleyin."),
    );
  } else if ((watch.rateLimitHits ?? 0) > 0) {
    const waits = watch.cooldownWaits ?? 0;
    warnings.push(
      `Ücretsiz imzalama kotası ${watch.rateLimitHits} kez doldu; ` +
        (waits > 0
          ? `${waits} kez ${watch.cooldownSeconds ?? 0} sn beklenip yeniden denendi`
          : "reddedilen odalar bekletilip yeniden denendi") +
        ".",
    );
  }
  if (watch.connected === 0 && (watch.requested ?? 0) > 0) {
    warnings.push(`Hiçbir odaya bağlanılamadı (${watch.requested} oda denendi, ${watch.failed ?? 0} hata).`);
  }

  // Şema sürüklenmesi: tanınmayan zarf/çanta tipi girdiyse rapor örnek tipiyle
  // birlikte uyarır. Sessizce yeni tipe düşmek, sandıkların görünmemesi demektir.
  const drift = envelopeTypeDrift(watch.messageTypes);
  if (drift.unknown.length) {
    // Sayılar her turda değişebilir; uyarı imzası sabit kalsın diye yalnızca tip adları yazılır.
    const detail = drift.unknown
      .slice(0, 3)
      .map((row) => row.type)
      .join(", ");
    warnings.push(
      `Zarf şeması sürüklenmesi: bilinmeyen zarf/çanta mesaj tipi ${detail}. ` +
        `Örnek: ${drift.unknown[0].type}. Dönüştürücü bu tipi tanımıyor; ` +
        "ad değiştiyse scripts/envelope-watch.mjs içindeki ENVELOPE_MESSAGE_TYPES listesine ekleyin.",
    );
  }

  // 24 saat sessizlik: dinleme çalışsa bile zarf tipi hiç gelmiyorsa tip adı
  // değişmiş olabilir. İlk çalıştırmada taban `trackingSince` ile kurulur.
  const silenceFrom = lastSeenAt || trackingSince;
  const silenceMs = Date.parse(String(silenceFrom ?? ""));
  if (Number.isFinite(silenceMs) && now - silenceMs >= 24 * 3_600_000) {
    warnings.push(
      `24 saattir hiç zarf/çanta mesaj tipi görülmedi (son örnek: ${sampleType || "bilinmiyor"}). ` +
        "TikTok tip adını değiştirmiş olabilir; ham WebSocket mesaj tiplerini kontrol edin.",
    );
  }
  return warnings;
}

/**
 * Odalara paralel bağlanır ve süre boyunca zarf mesajlarını toplar.
 *
 * Dönen değer kanıt niteliğindedir: kaç odaya bağlanıldı, kaç protokol mesajı
 * çözüldü, hangi zarf tipleri görüldü ve tam olarak hangi zarflar okundu.
 */
export async function watchEnvelopes({
  rooms = [],
  seconds = 180,
  concurrency = 12,
  connectGapMs = 450,
  deadline = Date.now() + seconds * 1000,
  apiKey = process.env.EULER_API_KEY || "",
  // 0: her oda pencere sonuna kadar dinlenir. >0: oda başına en fazla bu kadar
  // kalınır; ilk oda verisi zaten okunduğu için kısa bağlantı yeterlidir.
  holdSeconds = 0,
  // Yakalanan zarfı anında dışarı verir (GitHub Actions → Telegram/Discord).
  onEnvelope = null,
  // Ham WebcastEnvelopeMessage karesini verir; fixture yakalama adımı buraya bağlanır.
  onRawEnvelope = null,
  // Test/ölçüm için connector enjeksiyonu; verilmezse SDK dinamik yüklenir.
  sdk: providedSdk = null,
  log = () => {},
} = {}) {
  const result = {
    requested: rooms.length,
    connected: 0,
    // Benzersiz oda sayısı: yeniden denemeler `connected`i şişirir, bütçe
    // ölçümünde gerçekten kaç odaya girildiğini bu sayaç gösterir.
    connectedRooms: 0,
    attempted: 0,
    failed: 0,
    rateLimited: false,
    rateLimitHits: 0,
    signedWithKey: Boolean(apiKey),
    // Kota beklemesi: panel "kota doldu" demek yerine yeniden deneme anını
    // geri sayabilsin diye bekleme penceresi de sonuca yazılır.
    cooldownUntil: null,
    cooldownSeconds: 0,
    cooldownWaits: 0,
    envelopes: [],
    messageTypes: {},
    errors: [],
    startedAt: new Date().toISOString(),
    seconds: 0,
  };
  if (!rooms.length || seconds <= 0) return result;

  let sdk = providedSdk;
  if (!sdk) {
    try {
      sdk = await import("tiktok-live-connector");
    } catch (error) {
      result.errors.push(`connector yok: ${error instanceof Error ? error.message : "hata"}`);
      return result;
    }
  }
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = sdk;
  if (!TikTokLiveConnection) {
    result.errors.push("connector: TikTokLiveConnection bulunamadı");
    return result;
  }

  // Anahtarlı imzalama: kotayı yükseltir ve dakikalık bağlantı sınırını kaldırır.
  let eulerApiInstance;
  if (apiKey) {
    try {
      const { default: EulerClient } = await import("tiktok-live-api-sdk");
      eulerApiInstance = new EulerClient({
        basePath: "https://api.eulerstream.com",
        apiKey,
        baseOptions: {
          timeout: 10_000,
          validateStatus: () => true,
          headers: { "User-Agent": "ArenaLiveOS/1.3 (tiktok-live-connector/2.5.0)" },
        },
      });
    } catch (error) {
      result.errors.push(`euler istemcisi yüklenemedi: ${error instanceof Error ? error.message : "hata"}`);
    }
  }

  const seen = new Set();
  // Yakalama dosyası CLI çıkarken yarım kalmasın diye bekleyen yazmalar izlenir.
  const capturePending = new Set();
  const targets = [];
  for (const room of rooms) {
    const roomId = roomKey(room.roomId);
    if (!roomId || seen.has(roomId)) continue;
    seen.add(roomId);
    targets.push({ ...room, roomId, username: handle(room.username) });
  }

  const startedAt = Date.now();
  // Ham kareyi yakalama adımına verir; dinlemeyi hiçbir zaman durdurmaz.
  const captureRaw = (raw, room, method) => {
    if (!raw || typeof onRawEnvelope !== "function") return;
    try {
      const pending = onRawEnvelope(raw, room, method);
      if (pending && typeof pending.then === "function") {
        const tracked = Promise.resolve(pending)
          .catch((error) => log(`zarf yakalama hatası: ${error instanceof Error ? error.message : "hata"}`))
          .finally(() => capturePending.delete(tracked));
        capturePending.add(tracked);
      }
    } catch (error) {
      log(`zarf yakalama hatası: ${error instanceof Error ? error.message : "hata"}`);
    }
  };
  const collect = (reward, room = null) => {
    if (!reward || seen.size === 0) return;
    if (result.envelopes.some((row) => row.envelopeId === reward.envelopeId)) return;
    result.envelopes.push(reward);
    log(`zarf yakalandı: ${reward.envelopeId} · ${reward.coins} koin · ${reward.slots} kişi · oda ${reward.roomId}`);
    // Bildirim hatası dinlemeyi durdurmaz; sadece nedeni log'a yazılır.
    if (typeof onEnvelope === "function") {
      try {
        onEnvelope(reward, room);
      } catch (error) {
        log(`zarf bildirimi kuyruğa alınamadı: ${error instanceof Error ? error.message : "hata"}`);
      }
    }
  };

  let index = 0;
  let cooldownUntil = 0;
  const connectedRoomIds = new Set();
  // Kota hatası odayı kaybettirmez; pencere açılınca yeniden denenir.
  const attempts = new Map();
  const retry = (room) => {
    const count = (attempts.get(room.roomId) || 0) + 1;
    attempts.set(room.roomId, count);
    if (count <= 2) targets.push(room);
  };
  // Ücretsiz imzalama kotası dakikalık; pencereyi bekleyip devam etmek,
  // kalan odaları tamamen bırakmaktan iyidir.
  const coolDown = async () => {
    cooldownUntil = Math.max(cooldownUntil, Date.now() + 35_000);
    result.cooldownWaits += 1;
    result.cooldownSeconds = Math.max(result.cooldownSeconds, Math.ceil((cooldownUntil - Date.now()) / 1000));
    result.cooldownUntil = new Date(cooldownUntil).toISOString();
    await sleep(cooldownUntil - Date.now());
  };
  const worker = async () => {
    // Aralık işçi başına sayılır: global sıra numarası, son odaları diğer
    // işçiler çoktan iş bitirmiş olsa bile onlarca saniye boş yere bekletiyordu.
    let slot = 0;
    // Anahtarlı imzalamada kota bittiğinde yeni bağlantı açmak boşuna; anahtarsız
    // modda dakikalık pencere beklenir.
    while (index < targets.length && Date.now() < deadline && !result.rateLimited) {
      if (Date.now() < cooldownUntil) await sleep(cooldownUntil - Date.now());
      if (Date.now() >= deadline) return;
      // Birden fazla işçi aynı anda sayacı okuyabilir; sıra numarasını tek adımda al.
      const position = index++;
      if (position >= targets.length) return;
      const room = targets[position];
      await sleep(connectGapMs * slot);
      slot += 1;
      if (Date.now() >= deadline) return;
      let conn;
      try {
        conn = new TikTokLiveConnection(room.username || room.roomId, {
          fetchRoomInfoOnConnect: false,
          processInitialData: true,
          enableExtendedGiftInfo: false,
          wsClientOptions: { handshakeTimeout: 12_000 },
          ...(eulerApiInstance ? { eulerApiInstance } : {}),
        });
      } catch (error) {
        result.failed += 1;
        if (result.errors.length < 20) result.errors.push(`bağlantı kurulamadı (${room.roomId}): ${error instanceof Error ? error.message : "hata"}`);
        continue;
      }

      conn.on(WebcastEvent?.ENVELOPE ?? "envelope", (raw) => {
        captureRaw(raw, room, "WebcastEnvelopeMessage");
        collect(envelopeReward(raw, room.roomId), room);
      });
      conn.on(ControlEvent?.DECODED_DATA ?? "decodedData", (method, raw) => {
        const name = String(method || "");
        result.messageTypes[name] = (result.messageTypes[name] || 0) + 1;
        const payload = obj(raw).data ?? raw;
        if (/Envelope/i.test(name)) {
          captureRaw(payload, room, name);
          collect(envelopeReward(payload, room.roomId), room);
        } else if (/GoodyBag/i.test(name)) collect(bagReward(payload, room.roomId), room);
      });
      conn.on(ControlEvent?.ERROR ?? "error", () => null);

      try {
        result.attempted += 1;
        const connected = await conn.connect(room.roomId);
        if (!connected?.isConnected) throw new Error("bağlantı doğrulanamadı");
        result.connected += 1;
        connectedRoomIds.add(room.roomId);
        result.connectedRooms = connectedRoomIds.size;
        // Odaya girer girmez ilk oda verisindeki zarfları oku: sandık biz
        // bağlanmadan önce açılmışsa yalnızca akışı beklemek onu kaçırırdı.
        // Oda bilgisi imzalama kotası harcamaz; hata dinlemeyi düşürmez.
        try {
          const cached = obj(conn.roomInfo);
          const info = Object.keys(cached).length ? cached : await conn.fetchRoomInfo(room.roomId);
          for (const reward of roomEnvelopeRewards(info, room.roomId)) collect(reward, room);
        } catch {
          /* oda bilgisi alınamadı; zarf yine WS akışından yakalanır */
        }
        log(`dinleniyor: ${room.username || room.roomId} (${room.roomId})`);
        const holdUntil = Date.now() + connectionHoldMs(deadline, holdSeconds);
        while (Date.now() < holdUntil) await sleep(Math.min(2_000, Math.max(0, holdUntil - Date.now())));
      } catch (error) {
        result.failed += 1;
        const message = error instanceof Error ? error.message : String(obj(error).message ?? "hata");
        if (/rate.?limit|too many connections|\b429\b/i.test(message)) {
          result.rateLimitHits += 1;
          if (apiKey) result.rateLimited = true;
          else {
            retry(room);
            await coolDown();
          }
        }
        if (result.errors.length < 20) result.errors.push(`ws (${room.roomId}): ${message.split("\n")[0]}`);
      } finally {
        await conn.disconnect().catch(() => null);
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(clamp(concurrency, 1, 40), targets.length) }, () => worker()));
  } finally {
    if (capturePending.size) await Promise.allSettled([...capturePending]);
    result.seconds = Math.round((Date.now() - startedAt) / 1000);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Tek başına çalıştırma                                                      */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = { rooms: [], from: "", limit: 40, seconds: 180, capture: "" };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--from") { args.from = next; i += 1; }
    else if (flag === "--room") { args.rooms.push(next); i += 1; }
    else if (flag === "--rooms") { args.limit = Number(next); i += 1; }
    else if (flag === "--seconds") { args.seconds = Number(next); i += 1; }
    else if (flag === "--capture") { args.capture = next; i += 1; }
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile } = await import("node:fs/promises");
  const { createEnvelopeCapture } = await import("./envelope-capture.mjs");
  const args = parseArgs(process.argv.slice(2));
  const captureFile = args.capture || process.env.ARENA_CAPTURE_ENVELOPE || "";
  const capture = captureFile
    ? createEnvelopeCapture(captureFile, { log: (line) => console.log(`[zarf] ${line}`) })
    : null;
  const rooms = args.rooms.map((value) => {
    const [roomId, username] = String(value).split(":");
    return { roomId, username };
  });
  if (args.from) {
    const snapshot = JSON.parse(await readFile(args.from, "utf8"));
    for (const row of list(obj(snapshot).streams).slice(0, clamp(args.limit, 1, 200))) {
      rooms.push({ roomId: row.roomId, username: row.username, nickname: row.nickname, title: row.title });
    }
  }
  if (!rooms.length) {
    console.error("Dinlenecek oda yok. --from <arena-live.json> veya --room <roomId>:<username> kullanın.");
    process.exit(1);
  }
  const watch = await watchEnvelopes({
    rooms,
    seconds: clamp(args.seconds, 10, 1800),
    onRawEnvelope: capture,
    log: (line) => console.log(`[zarf] ${line}`),
  });
  console.log(
    `[zarf] ${watch.connectedRooms}/${watch.requested} oda bağlandı · ${watch.seconds}s · ` +
      `${watch.connected} bağlantı / ${watch.attempted} deneme · ${watch.envelopes.length} zarf · ${watch.failed} hata`,
  );
  console.log(`[zarf] mesaj tipleri: ${JSON.stringify(Object.entries(watch.messageTypes).sort((a, b) => b[1] - a[1]).slice(0, 10))}`);
  if (watch.envelopes.length) console.log(`[zarf] yakalananlar: ${JSON.stringify(watch.envelopes, null, 1)}`);
  if (captureFile && !watch.envelopes.length) console.log(`[zarf] yakalama: gerçek zarf gelmedi, fixture değişmedi (${captureFile})`);
  for (const error of watch.errors.slice(0, 5)) console.log(`[zarf] uyarı: ${error}`);
  process.exit(watch.connected > 0 ? 0 : 1);
}
