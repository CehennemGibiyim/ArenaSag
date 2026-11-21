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
  log = () => {},
} = {}) {
  const result = {
    requested: rooms.length,
    connected: 0,
    failed: 0,
    rateLimited: false,
    rateLimitHits: 0,
    signedWithKey: Boolean(apiKey),
    envelopes: [],
    messageTypes: {},
    errors: [],
    startedAt: new Date().toISOString(),
    seconds: 0,
  };
  if (!rooms.length || seconds <= 0) return result;

  let sdk;
  try {
    sdk = await import("tiktok-live-connector");
  } catch (error) {
    result.errors.push(`connector yok: ${error instanceof Error ? error.message : "hata"}`);
    return result;
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
  const targets = [];
  for (const room of rooms) {
    const roomId = roomKey(room.roomId);
    if (!roomId || seen.has(roomId)) continue;
    seen.add(roomId);
    targets.push({ ...room, roomId, username: handle(room.username) });
  }

  const startedAt = Date.now();
  const collect = (reward) => {
    if (!reward || seen.size === 0) return;
    if (result.envelopes.some((row) => row.envelopeId === reward.envelopeId)) return;
    result.envelopes.push(reward);
    log(`zarf yakalandı: ${reward.envelopeId} · ${reward.coins} koin · ${reward.slots} kişi · oda ${reward.roomId}`);
  };

  let index = 0;
  let cooldownUntil = 0;
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
    await sleep(cooldownUntil - Date.now());
  };
  const worker = async () => {
    // Anahtarlı imzalamada kota bittiğinde yeni bağlantı açmak boşuna; anahtarsız
    // modda dakikalık pencere beklenir.
    while (index < targets.length && Date.now() < deadline && !result.rateLimited) {
      if (Date.now() < cooldownUntil) await sleep(cooldownUntil - Date.now());
      if (Date.now() >= deadline) return;
      // Birden fazla işçi aynı anda sayacı okuyabilir; sıra numarasını tek adımda al.
      const position = index++;
      if (position >= targets.length) return;
      const room = targets[position];
      await sleep(connectGapMs * position);
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

      conn.on(WebcastEvent?.ENVELOPE ?? "envelope", (raw) => collect(envelopeReward(raw, room.roomId)));
      conn.on(ControlEvent?.DECODED_DATA ?? "decodedData", (method, raw) => {
        const name = String(method || "");
        result.messageTypes[name] = (result.messageTypes[name] || 0) + 1;
        const payload = obj(raw).data ?? raw;
        if (/Envelope/i.test(name)) collect(envelopeReward(payload, room.roomId));
        else if (/GoodyBag/i.test(name)) collect(bagReward(payload, room.roomId));
      });
      conn.on(ControlEvent?.ERROR ?? "error", () => null);

      try {
        const connected = await conn.connect(room.roomId);
        if (!connected?.isConnected) throw new Error("bağlantı doğrulanamadı");
        result.connected += 1;
        log(`dinleniyor: ${room.username || room.roomId} (${room.roomId})`);
        while (Date.now() < deadline) await sleep(Math.min(2_000, Math.max(0, deadline - Date.now())));
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
    result.seconds = Math.round((Date.now() - startedAt) / 1000);
  }
  return result;
}

/* -------------------------------------------------------------------------- */
/*  Tek başına çalıştırma                                                      */
/* -------------------------------------------------------------------------- */

function parseArgs(argv) {
  const args = { rooms: [], from: "", limit: 40, seconds: 180 };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const next = argv[i + 1];
    if (flag === "--from") { args.from = next; i += 1; }
    else if (flag === "--room") { args.rooms.push(next); i += 1; }
    else if (flag === "--rooms") { args.limit = Number(next); i += 1; }
    else if (flag === "--seconds") { args.seconds = Number(next); i += 1; }
  }
  return args;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile } = await import("node:fs/promises");
  const args = parseArgs(process.argv.slice(2));
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
    log: (line) => console.log(`[zarf] ${line}`),
  });
  console.log(
    `[zarf] ${watch.connected}/${watch.requested} oda dinlendi · ${watch.seconds}s · ` +
      `${watch.envelopes.length} zarf · ${watch.failed} bağlantı hatası`,
  );
  console.log(`[zarf] mesaj tipleri: ${JSON.stringify(Object.entries(watch.messageTypes).sort((a, b) => b[1] - a[1]).slice(0, 10))}`);
  if (watch.envelopes.length) console.log(`[zarf] yakalananlar: ${JSON.stringify(watch.envelopes, null, 1)}`);
  for (const error of watch.errors.slice(0, 5)) console.log(`[zarf] uyarı: ${error}`);
  process.exit(watch.connected > 0 ? 0 : 1);
}
