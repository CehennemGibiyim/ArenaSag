#!/usr/bin/env node
/**
 * Arena Radar — GitHub Actions üzerinde çalışan bağımsız tarayıcı.
 *
 * Panel, PostgreSQL veya kullanıcı oturumu gerektirmez. Kamuya açık TikTok
 * uçlarından aday yayıncıları toplar, canlılığı doğrular ve sandık/mektup
 * zarfı verilerini `web/data/arena-live.json` dosyasına yazar. GitHub Pages ve
 * Windows Radar uygulaması bu dosyayı okur.
 *
 * Tarama artık iki aşamalıdır:
 *   1. Keşif: aday havuzu doğrulanır (yeni yayıncılar üye defterine eklenir).
 *   2. Oda nöbeti: bilinen tüm oda kimlikleri `check_alive` ile UCUZCA canlılık
 *      kontrolünden geçer, ardından canlı odalar birkaç turda `room/info` ile
 *      sandık/mektup için taranır. Böylece tek turda 40 oda değil, yüzlerce oda
 *      görülür ve tur boyunca açılan sandıklar da yakalanır.
 *   3. WebSocket dinleyicisi: `room/info` çoğu odada zarf alanı döndürmez;
 *      sandık ve mektup yalnızca canlı akışta `WebcastEnvelopeMessage` olarak
 *      düşer. En yoğun odalara paralel bağlanılıp bu mesajlar doğrudan
 *      yakalanır ve aynı sandık listesine yazılır.
 *
 * Kullanım:
 *   node scripts/radar-publish.mjs
 *   ARENA_MAX_CHECKS=480 ARENA_CHEST_ROUNDS=4 node scripts/radar-publish.mjs
 *
 * Ortam değişkenleri:
 *   ARENA_REGIONS            Virgülle ayrılmış bölge kodları (varsayılan: TR + rotasyon)
 *   ARENA_MAX_CHECKS         Doğrulanacak en fazla aday (varsayılan 800)
 *   ARENA_MAX_ROOMS          Her sandık turunda sorgulanacak en fazla canlı oda (varsayılan 320)
 *   ARENA_MAX_STREAMS        Listede tutulacak en fazla canlı yayın (varsayılan 240)
 *   ARENA_CHEST_ROUNDS       Tur içinde yapılacak sandık taraması sayısı (varsayılan 4)
 *   ARENA_CHEST_ROUND_GAP    Turlar arası saniye (varsayılan 45)
 *   ARENA_BUDGET_SECONDS     Tarama için toplam süre bütçesi (varsayılan 540)
 *   ARENA_MAX_CHEST_AGE      Saat cinsinden sandık hafızası (varsayılan 12)
 *   ARENA_ENVELOPE_ROOMS     WebSocket ile dinlenecek oda sayısı (varsayılan 40, 0 = kapalı)
 *   ARENA_ENVELOPE_SECONDS   Dinleme süresi (varsayılan 180)
 *   ARENA_ENVELOPE_CONCURRENCY Aynı anda açık WebSocket sayısı (varsayılan 12)
 *   EULER_API_KEY            Tanımlıysa WebSocket imzalamasında kullanılır
 *   ARENA_VERIFY_CONCURRENCY Aday doğrulama eşzamanlılığı (varsayılan 8)
 *   ARENA_ROOM_CONCURRENCY   Oda sorgulama eşzamanlılığı (varsayılan 10)
 *   ARENA_STREAMERS          Ek yayıncı listesi (@a,@b)
 *   ARENA_OUT_DIR            Çıktı klasörü (varsayılan: web/data)
 *   ARENA_OUT_FILE           Çıktı dosya adı (varsayılan: arena-live.json)
 *   ARENA_DATA_BRANCH        Verinin yayınlandığı dal (varsayılan: data)
 *   ARENA_ROSTER_MAX         Üye defterinde tutulacak en fazla yayıncı (varsayılan: 20000)
 *   SUPABASE_URL             Ayarlıysa üye defteri ve sandıklar Supabase'e yazılır
 *   SUPABASE_SERVICE_ROLE_KEY Supabase yazma anahtarı (yalnızca Actions secret'ı)
 *
 * Ayrıca `roster.json` yazar: her taramada doğrulanan yayıncıların gün gün
 * büyüyen, kimsenin silinmediği listesi. Veri `data` dalına işlenir; `main`
 * yalnızca kodu taşır.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateRoster, validateSnapshot } from "./radar-contract.mjs";
import { envelopeSchemaState, envelopeWarnings, watchEnvelopes } from "./envelope-watch.mjs";
import { createEnvelopeNotifier } from "./radar-notify.mjs";
import { mergeShardWatches, readShardResults, shardCoverage } from "./envelope-shards.mjs";
import { applyChestReward } from "./chest-record.mjs";
import { mirrorToSupabase } from "./supabase-mirror.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = process.env.ARENA_OUT_DIR
  ? path.resolve(process.env.ARENA_OUT_DIR)
  : path.join(ROOT, "web", "data");
const OUT_FILE = path.join(OUT_DIR, process.env.ARENA_OUT_FILE || "arena-live.json");
const VERSION_FILE = path.join(OUT_DIR, "version.json");

const REPO = process.env.ARENA_GITHUB_REPO || "CehennemGibiyim/ArenaSag";
const DIRECTORY_URL =
  process.env.ARENA_DIRECTORY_URL ||
  "https://raw.githubusercontent.com/CehennemGibiyim/TikTok/main/site/firsat/data/targets.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const MAX_CHECKS = clamp(Number(process.env.ARENA_MAX_CHECKS || 1000), 40, 1600);
const MAX_ROOMS = clamp(Number(process.env.ARENA_MAX_ROOMS || 420), 20, 900);
const MAX_STREAMS = clamp(Number(process.env.ARENA_MAX_STREAMS || 300), 10, 600);
const CHEST_ROUNDS = clamp(Number(process.env.ARENA_CHEST_ROUNDS || 6), 1, 8);
const ENVELOPE_ROOMS = clamp(Number(process.env.ARENA_ENVELOPE_ROOMS || 40), 0, 200);
const ENVELOPE_SECONDS = clamp(Number(process.env.ARENA_ENVELOPE_SECONDS || 180), 0, 600);
const ENVELOPE_CONCURRENCY = clamp(Number(process.env.ARENA_ENVELOPE_CONCURRENCY || 12), 1, 40);
const CHEST_ROUND_GAP_MS = clamp(Number(process.env.ARENA_CHEST_ROUND_GAP || 45), 10, 180) * 1000;
const VERIFY_CONCURRENCY = clamp(Number(process.env.ARENA_VERIFY_CONCURRENCY || 8), 1, 16);
const ROOM_CONCURRENCY = clamp(Number(process.env.ARENA_ROOM_CONCURRENCY || 10), 1, 20);
const MAX_CHEST_AGE_MS = clamp(Number(process.env.ARENA_MAX_CHEST_AGE || 12), 1, 48) * 3_600_000;
const MAX_CHESTS = 500;
// Bir oda iki tur üst üste zarfı bildirmezse sandık "kapandı" sayılır.
const CHEST_MISS_LIMIT = 2;
// Kapanan sandık, kullanıcı sonucu görebilsin diye bir süre listede kalır.
const CLOSED_CHEST_KEEP_MS = 20 * 60_000;
const DATA_BRANCH = process.env.ARENA_DATA_BRANCH || "data";
const ROSTER_FILE = path.join(OUT_DIR, "roster.json");
const ROSTER_MAX = clamp(Number(process.env.ARENA_ROSTER_MAX || 20_000), 200, 50_000);
const ROSTER_DAY_MAX = 90;
const MAX_ATTEMPTS = 3;
const RETRYABLE = new Set([403, 408, 429, 500, 502, 503, 504]);
const NOW = Date.now();
const BUDGET_MS = clamp(Number(process.env.ARENA_BUDGET_SECONDS || 780), 120, 1500) * 1000;
const DEADLINE = NOW + BUDGET_MS;
// Keşif, zarf dinleyicisinin penceresini yemesin: dinleme için süre ayrılır.
const DISCOVERY_DEADLINE =
  NOW + Math.max(60_000, BUDGET_MS - (ENVELOPE_ROOMS > 0 ? Math.min(ENVELOPE_SECONDS, 300) * 1000 : 0));

const TIKTOK_REGIONS = [
  "TR", "US", "DE", "GB", "FR", "NL", "IT", "ES", "SA", "AE", "EG", "MA",
  "BR", "MX", "AR", "ID", "MY", "PH", "PK", "IN", "BD", "RU", "UA", "PL", "AZ", "KZ",
];

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

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
const regionCode = (value) => {
  const code = str(value, 4).toUpperCase();
  if (code === "UK") return "GB";
  return /^[A-Z]{2}$/.test(code) && !["ZZ", "XX"].includes(code) ? code : "";
};

function timestampSeconds(value) {
  if (value === undefined || value === null || value === "") return 0;
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) return 0;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  if (ms < NOW - 6 * 3_600_000 || ms > NOW + 24 * 3_600_000) return 0;
  return Math.floor(ms / 1000);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Geçici hata / hız sınırı mı? 403 ve 429 TikTok tarafında en sık görülen engel.
function retryable(error) {
  const status = Number(error?.status || 0);
  if (status) return RETRYABLE.has(status);
  return error instanceof TypeError || ["TimeoutError", "AbortError"].includes(error?.name);
}

async function getJson(url, timeout = 9_000, attempt = 1) {
  try {
    // Küçük jitter: aynı saniyede çok sayıda istek atıp engellenmemek için.
    if (attempt === 1) await sleep(Math.floor(Math.random() * 120));
    const response = await fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: "application/json",
        "Accept-Language": "tr-TR,tr;q=0.9,en;q=0.8",
        Referer: "https://www.tiktok.com/live",
      },
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(timeout),
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = Number(response.headers.get("retry-after") || 0) * 1000;
      throw error;
    }
    const text = await response.text();
    if (!text) throw new Error("Boş yanıt");
    return JSON.parse(text);
  } catch (error) {
    if (attempt >= MAX_ATTEMPTS || !retryable(error)) throw error;
    const backoff = Number(error?.retryAfter || 0) || 400 * 2 ** (attempt - 1) + Math.floor(Math.random() * 300);
    await sleep(Math.min(backoff, 8_000));
    return getJson(url, timeout, attempt + 1);
  }
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = index++;
        output[current] = await fn(items[current], current);
      }
    }),
  );
  return output;
}

async function readPrevious() {
  try {
    const raw = JSON.parse(await readFile(OUT_FILE, "utf8"));
    if (obj(raw).schema !== 1) return { streams: [], chests: [] };
    return { streams: list(raw.streams), chests: list(raw.chests) };
  } catch {
    return { streams: [], chests: [] };
  }
}

/**
 * Üye defterini oku: önce yerel kopya, yoksa veri dalındaki yayın.
 * Kimse silinmez; her tarama yalnızca ekler ve son görülme zamanını tazeler.
 */
async function readRoster() {
  const parse = (raw) => {
    const data = obj(raw);
    if (data.schema !== 1) return null;
    return { streamers: list(data.streamers), days: obj(data.days) };
  };
  try {
    const local = parse(JSON.parse(await readFile(ROSTER_FILE, "utf8")));
    if (local) return local;
  } catch {
    /* ilk çalıştırma */
  }
  try {
    const remote = parse(
      await getJson(`https://raw.githubusercontent.com/${REPO}/${DATA_BRANCH}/web/data/roster.json`, 12_000),
    );
    if (remote) return remote;
  } catch {
    /* veri dalı henüz yok */
  }
  return { streamers: [], days: {} };
}

/** Önceki defter ile bu turun doğrulanmış yayınlarını birleştirir. */
function mergeRoster(roster, streams) {
  const nowIso = new Date(NOW).toISOString();
  const seen = new Map();
  const isNew = [];

  for (const row of roster.streamers) {
    const username = handle(row.username);
    if (!username) continue;
    seen.set(username, {
      username,
      nickname: str(row.nickname, 80) || username,
      avatar: str(row.avatar, 500),
      region: regionCode(row.region),
      roomId: roomKey(row.roomId),
      firstSeen: str(row.firstSeen, 30) || nowIso,
      lastSeen: str(row.lastSeen, 30) || nowIso,
      lastLiveAt: str(row.lastLiveAt, 30),
      liveCount: integer(row.liveCount),
    });
  }

  for (const stream of streams) {
    const username = handle(stream.username);
    if (!username) continue;
    const previousRow = seen.get(username);
    const next = {
      username,
      nickname: str(stream.nickname, 80) || previousRow?.nickname || username,
      avatar: str(stream.avatar, 500) || previousRow?.avatar || "",
      region: regionCode(stream.region) || previousRow?.region || "",
      roomId: roomKey(stream.roomId) || previousRow?.roomId || "",
      firstSeen: previousRow?.firstSeen || nowIso,
      lastSeen: nowIso,
      lastLiveAt: stream.stale ? previousRow?.lastLiveAt || nowIso : nowIso,
      liveCount: (previousRow?.liveCount || 0) + (stream.stale ? 0 : 1),
    };
    if (!previousRow) isNew.push(username);
    seen.set(username, next);
  }

  const streamers = [...seen.values()]
    .sort((a, b) => b.lastSeen.localeCompare(a.lastSeen))
    .slice(0, ROSTER_MAX);

  const day = new Date(NOW).toISOString().slice(0, 10);
  const days = { ...roster.days };
  const current = obj(days[day]);
  days[day] = {
    added: (integer(current.added) || 0) + isNew.length,
    total: streamers.length,
    streams: streams.length,
  };
  const keptDays = Object.keys(days)
    .sort((a, b) => b.localeCompare(a))
    .slice(0, ROSTER_DAY_MAX)
    .reduce((acc, key) => {
      acc[key] = days[key];
      return acc;
    }, {});

  return {
    isNew,
    streamers,
    days: keptDays,
    today: { date: day, added: integer(obj(keptDays[day]).added), total: streamers.length },
  };
}

function addCandidate(map, entry) {
  const username = handle(entry.username);
  if (!username) return;
  const existing = map.get(username);
  const next = {
    username,
    nickname: str(entry.nickname, 80) || existing?.nickname || username,
    roomId: roomKey(entry.roomId) || existing?.roomId || "",
    region: regionCode(entry.region) || existing?.region || "",
    source: entry.source || existing?.source || "unknown",
  };
  if (!existing || (!existing.roomId && next.roomId)) map.set(username, next);
}

function parseTicker(payload) {
  const rows = list(obj(payload).channels).slice(0, 20);
  return rows
    .map((row) => ({
      username: obj(row).uniqueId,
      nickname: obj(row).displayName,
      roomId: obj(row).roomId,
      region: obj(row).region,
      source: "tik.tools",
    }))
    .filter((row) => row.username);
}

async function fetchDirectory() {
  const payload = await getJson(DIRECTORY_URL, 12_000);
  const rows = list(obj(payload).targets).slice(0, 12_000);
  return rows
    .map((row) => ({
      username: obj(row).username,
      nickname: obj(row).username,
      region: obj(row).country,
      source: "directory",
    }))
    .filter((row) => row.username);
}

async function fetchRegions() {
  const payload = await getJson("https://www.tikwm.com/api/region", 9_000);
  if (Number(obj(payload).code) !== 0) throw new Error("Bölge listesi alınamadı");
  return [...new Set(Object.keys(obj(obj(payload).data)).map(regionCode).filter(Boolean))];
}

function pickRegions(codes) {
  const configured = String(process.env.ARENA_REGIONS || "")
    .split(",")
    .map(regionCode)
    .filter(Boolean);
  if (configured.length) return configured.slice(0, 8);
  const supported = codes.filter((code) => TIKTOK_REGIONS.includes(code));
  if (!supported.length) return ["TR"];
  const bucket = Math.floor(NOW / (10 * 60_000));
  const picks = new Set(["TR"]);
  for (let i = 0; i < 4 && picks.size < 6; i += 1) {
    picks.add(supported[(bucket * 3 + i * 5) % supported.length]);
  }
  return [...picks].slice(0, 6);
}

async function fetchMarket(region) {
  const payload = await getJson(
    `https://www.tikwm.com/api/feed/list?region=${encodeURIComponent(region)}&count=14`,
    9_000,
  );
  if (Number(obj(payload).code) !== 0) throw new Error(`${region}: liste alınamadı`);
  return list(obj(payload).data)
    .slice(0, 14)
    .map((row) => ({
      username: obj(obj(row).author).unique_id,
      nickname: obj(obj(row).author).nickname,
      region,
      source: "tikwm",
    }))
    .filter((row) => row.username);
}

async function userRoom(username) {
  const params = new URLSearchParams({ aid: "1988", uniqueId: username, sourceType: "54" });
  const payload = await getJson(`https://www.tiktok.com/api-live/user/room/?${params}`);
  const data = obj(payload.data);
  const user = obj(data.user);
  const live = obj(data.liveRoom);
  const roomId = roomKey(user.roomId);
  if (!roomId) return null;
  return {
    username,
    roomId,
    nickname: str(user.nickname, 80) || username,
    title: str(live.title, 160),
    avatar: str(list(obj(user.avatarThumb).url_list)[0], 500),
    status: Number(live.status) || 0,
    region: regionCode(user.region),
  };
}

/**
 * Toplu canlılık: elli oda kimliği tek istekte sorulur. Oda kimliği bilinen
 * her yayıncı için tek tek `user/room` çağırmaktan çok daha ucuz olduğu için
 * sandık nöbetinin omurgası budur.
 */
async function checkAlive(roomIds) {
  const alive = new Map();
  for (let i = 0; i < roomIds.length; i += 50) {
    if (Date.now() > DISCOVERY_DEADLINE) break;
    const chunk = roomIds.slice(i, i + 50);
    try {
      const params = new URLSearchParams({ aid: "1988", room_ids: chunk.join(",") });
      const payload = await getJson(`https://webcast.tiktok.com/webcast/room/check_alive/?${params}`, 12_000);
      for (const row of list(obj(payload).data)) {
        const item = obj(row);
        const id = roomKey(item.room_id_str ?? item.room_id);
        if (id && typeof item.alive === "boolean") alive.set(id, item.alive);
      }
    } catch (error) {
      errors.push(`check_alive: ${error instanceof Error ? error.message : "hata"}`);
    }
  }
  return alive;
}

/**
 * Oda yükündeki olası ödül kapsayıcıları. TikTok sandığı `envelope_info`
 * içinde verir; aynı yapı mektup/parsel/çanta için farklı adlarla da
 * görülebildiğinden hepsi aynı normalize ediciyle okunur.
 */
const REWARD_CONTAINERS = [
  "envelopeInfo", "envelope_info",
  "envelopeList", "envelope_list",
  "redEnvelopeInfo", "red_envelope_info",
  "redEnvelopeList", "red_envelope_list",
  "letterInfo", "letter_info",
  "letterList", "letter_list",
  "parcelInfo", "parcel_info",
  "luckyBag", "lucky_bag",
  "goodyBag", "goody_bag",
];

function parseReward(raw, fallbackRoomId, container = "") {
  const record = obj(raw);
  const info = obj(record.envelopeInfo ?? record.envelope_info ?? record.envelope ?? record.letterInfo ?? record);
  const nested = obj(info.info ?? info.reward ?? info.detail ?? {});
  const pick = (...keys) => {
    for (const key of keys) {
      for (const source of [info, nested, record]) {
        const value = source[key];
        if (value !== undefined && value !== null && value !== "") return value;
      }
    }
    return undefined;
  };
  const envelopeId = str(pick("envelopeId", "envelope_id", "letterId", "letter_id", "parcelId", "parcel_id"), 80);
  const coins = integer(pick("diamondCount", "diamond_count", "coins", "coinCount", "coin_count", "amount"));
  const slots = integer(pick("peopleCount", "people_count", "slots", "slotCount", "slot_count", "count"));
  const opensAt = timestampSeconds(pick("unpackAt", "unpack_at", "openAt", "open_at", "expireAt", "expire_at"));
  if (!envelopeId || !coins || !slots || !opensAt) return null;
  return {
    envelopeId,
    roomId: roomKey(pick("roomId", "room_id")) || fallbackRoomId,
    coins,
    slots,
    opensAt,
    skinId: integer(pick("skinId", "skin_id")) || 1,
    businessType: integer(pick("businessType", "business_type")) || 1,
    container,
  };
}

function roomRewards(data, roomId) {
  const rewards = [];
  const seen = new Set();
  for (const container of REWARD_CONTAINERS) {
    const value = data[container];
    const entries = Array.isArray(value) ? value.slice(0, 20) : value ? [value] : [];
    for (const entry of entries) {
      const parsed = parseReward(entry, roomId, container);
      if (parsed && !seen.has(parsed.envelopeId)) {
        seen.add(parsed.envelopeId);
        rewards.push(parsed);
      }
    }
  }
  return rewards;
}

async function roomInfo(roomId) {
  try {
    const params = new URLSearchParams({ aid: "1988", room_id: roomId });
    const payload = await getJson(`https://webcast.tiktok.com/webcast/room/info/?${params}`, 12_000);
    const data = obj(obj(payload).data);
    const owner = obj(data.owner);
    const firstUrl = (value) => str(list(obj(value).url_list)[0], 500);
    return {
      roomId,
      username: handle(owner.display_id ?? owner.unique_id),
      nickname: str(owner.nickname, 80),
      title: str(data.title, 160),
      viewers: integer(data.user_count),
      avatar: firstUrl(owner.avatar_thumb),
      thumb: firstUrl(data.cover),
      region: regionCode(owner.region),
      rewards: roomRewards(data, roomId),
    };
  } catch (error) {
    if (errors.length < 40) errors.push(`room_info(${roomId}): ${error instanceof Error ? error.message : "hata"}`);
    return null;
  }
}

const errors = [];
const previous = await readPrevious();
const previousRoster = await readRoster();
const candidates = new Map();

// 1) Önceki taramanın canlı odaları — oda kimlikleri korunur, tekrar arama gerekmez.
for (const stream of previous.streams.slice(0, 60)) {
  addCandidate(candidates, { ...stream, source: "previous" });
}
// 2) Açık TikTok örneklemi.
try {
  for (const row of parseTicker(await getJson("https://api.tik.tools/api/live/top-channels", 9_000))) {
    addCandidate(candidates, row);
  }
} catch (error) {
  errors.push(`tik.tools: ${error instanceof Error ? error.message : "hata"}`);
}
// 3) Bölgesel trend örnekleri.
let regionCodes = [];
let regionsPicked = ["TR"];
try {
  regionCodes = await fetchRegions();
  regionsPicked = pickRegions(regionCodes);
} catch (error) {
  errors.push(`bölge listesi: ${error instanceof Error ? error.message : "hata"}`);
}
const marketResults = await Promise.allSettled(regionsPicked.map((region) => fetchMarket(region)));
for (const result of marketResults) {
  if (result.status === "fulfilled") for (const row of result.value.slice(0, 12)) addCandidate(candidates, row);
  else errors.push(`tikwm: ${result.reason instanceof Error ? result.reason.message : "hata"}`);
}
// 4) Kamuya açık yayıncı dizini — büyük listeden dönen, her turda kayan bir örneklem.
try {
  const rows = await fetchDirectory();
  const offset = rows.length ? Math.floor(NOW / 300_000) % rows.length : 0;
  for (let i = 0; i < Math.min(200, rows.length); i += 1) addCandidate(candidates, rows[(offset + i) % rows.length]);
} catch (error) {
  errors.push(`dizin: ${error instanceof Error ? error.message : "hata"}`);
}
// 5) Kendi üye defterimizden rotasyonlu örneklem: dış kaynaklar engellendiğinde de
//    aday üretilir ve doğrulanmış havuz her turda kullanılır.
const rosterPool = list(previousRoster.streamers);
if (rosterPool.length) {
  const offset = Math.floor(NOW / (10 * 60_000)) % rosterPool.length;
  for (let i = 0; i < Math.min(120, rosterPool.length); i += 1) {
    const row = obj(rosterPool[(offset + i) % rosterPool.length]);
    addCandidate(candidates, {
      username: row.username,
      nickname: row.nickname,
      roomId: row.roomId,
      region: row.region,
      source: "roster",
    });
  }
}
// 6) Elle verilen ek hesaplar.
for (const name of String(process.env.ARENA_STREAMS || process.env.ARENA_STREAMERS || "").split(",")) {
  addCandidate(candidates, { username: name, source: "streamers" });
}

const pool = [...candidates.values()].slice(0, MAX_CHECKS);
const verified = await mapLimit(pool, VERIFY_CONCURRENCY, async (candidate) => {
  if (Date.now() > DISCOVERY_DEADLINE) return null;
  try {
    const info = await userRoom(candidate.username);
    if (!info) return null;
    return { ...candidate, ...info, username: candidate.username, source: candidate.source };
  } catch (error) {
    if (errors.length < 40) errors.push(`user_room(@${candidate.username}): ${error instanceof Error ? error.message : "hata"}`);
    return null;
  }
});

const found = verified.filter(Boolean);

/* -------------------------------------------------------------------------- */
/*  Oda nöbeti — bilinen tüm odalar ucuz canlılık kontrolünden geçer            */
/* -------------------------------------------------------------------------- */

const universe = new Map();
const noteRoom = (row) => {
  const roomId = roomKey(row.roomId);
  if (!roomId) return;
  const existing = universe.get(roomId) || {};
  universe.set(roomId, {
    roomId,
    username: handle(row.username) || existing.username || "",
    nickname: str(row.nickname, 80) || existing.nickname || "",
    title: str(row.title, 160) || existing.title || "",
    avatar: str(row.avatar, 500) || existing.avatar || "",
    region: regionCode(row.region) || existing.region || "",
    viewers: integer(row.viewers) || existing.viewers || 0,
    source: row.source || existing.source || "previous",
  });
};

for (const row of found) noteRoom(row);
for (const row of previous.streams) if (!obj(row).stale) noteRoom(row);
for (const row of rosterPool) noteRoom(obj(row));

const aliveMap = await checkAlive([...universe.keys()]);
const aliveIds = new Set([...aliveMap.entries()].filter(([, value]) => value === true).map(([id]) => id));
// check_alive bir bölgede yanıt vermezse, doğrulanmış odalar yine taranır.
for (const row of found) if (!aliveMap.has(row.roomId)) aliveIds.add(row.roomId);

const previousChests = new Map(
  previous.chests
    .filter((chest) => chest && chest.envelopeId)
    .map((chest) => [str(chest.envelopeId, 80), chest]),
);

// Matris dinlemesi: her runner kendi IP kotasıyla ayrı odaları dinler ve
// artifact bırakır. Burada yalnızca birleştirilir; matris modunda yerel
// dinleyici açılmaz, böylece aynı odalar için kota iki kez harcanmaz.
const shardDir = process.env.ARENA_SHARD_DIR || "";
const shardResults = shardDir ? await readShardResults(shardDir) : [];
const shardWatch = mergeShardWatches(shardResults);
const shardStats = shardCoverage(shardResults);
if (shardDir) {
  console.log(
    `[arena-radar] matris dinlemesi: ${shardResults.length} artifact · ` +
      (shardWatch
        ? `${shardWatch.connectedRooms}/${shardWatch.requested} oda bağlandı · ${shardWatch.envelopes.length} zarf`
        : "sonuç yok"),
  );
}
// Sandığı görülen odalar her turda önce taranır: sandık akışının en yoğun yeri.
const hotRooms = new Set(
  previous.chests.map((chest) => roomKey(chest.roomId)).filter(Boolean),
);

const order = [...aliveIds]
  .map((roomId) => [roomId, universe.get(roomId) || { roomId, username: "", nickname: "", title: "", avatar: "", region: "", viewers: 0, source: "previous" }])
  .sort((a, b) => (hotRooms.has(b[0]) ? 1 : 0) - (hotRooms.has(a[0]) ? 1 : 0) || b[1].viewers - a[1].viewers);

// WebSocket zarf dinleyicisi oda nöbetiyle PARALEL çalışır: dinleme sürerken
// `room/info` turları da ilerler. Zarf yalnızca canlı akışta göründüğü için
// asıl yakalama yolu budur.
const watchRooms = order.slice(0, ENVELOPE_ROOMS).map(([roomId, meta]) => ({ ...meta, roomId }));
const watchSeconds = Math.min(ENVELOPE_SECONDS, Math.max(0, Math.round((DEADLINE - Date.now()) / 1000)));
// Zarf yakalandığı anda haber verilir: panel senkronu ve Pages yayını beklenmez.
// Adres yalnızca secret'tan gelir; aynı zarf bir kez, koşu başına en fazla dört
// mesaj gönderilir (kota sınırlı turlarda bildirim spam'i olmaz).
const notifier = createEnvelopeNotifier({
  // Shard'ların yakaladığı zarfı birleştirme işi ikinci kez bildirmez.
  known: [
    ...previousChests.keys(),
    ...(shardWatch?.envelopes ?? []).map((row) => str(row?.envelopeId, 80)).filter(Boolean),
  ],
  context: { requested: watchRooms.length, signedWithKey: Boolean(process.env.EULER_API_KEY) },
  log: (line) => console.log(`[arena-radar] ${line}`),
});
const watchPromise =
  !shardDir && watchRooms.length && watchSeconds >= 20
    ? watchEnvelopes({
        rooms: watchRooms,
        seconds: watchSeconds,
        // Ücretsiz imzalama dakikada birkaç bağlantıya izin verir; anahtar varsa tavan açılır.
        concurrency: process.env.EULER_API_KEY ? ENVELOPE_CONCURRENCY : Math.min(6, ENVELOPE_CONCURRENCY),
        apiKey: process.env.EULER_API_KEY || "",
        onEnvelope: (reward, room) => notifier.offer(reward, room),
        log: (line) => console.log(`[arena-radar] ${line}`),
      }).catch((error) => ({ connected: 0, failed: 0, envelopes: [], messageTypes: {}, errors: [`ws: ${error instanceof Error ? error.message : "hata"}`], seconds: 0 }))
    : Promise.resolve(null);

const chests = new Map(previousChests);
const streams = new Map();
const rounds = [];
let roomsScanned = 0;

const applyReward = (reward, stream) => {
  // Dönüşüm tek yerde (`chest-record.mjs`); replay testi aynı fonksiyonu çalıştırır.
  const applied = applyChestReward(chests, reward, stream);
  if (!applied) return false;
  // `room/info` turunda ilk kez görülen zarf da anında bildirilir; WS yakalaması
  // aynı kimliği daha önce verdiyse kuyruk tekrar göndermez.
  if (applied.isNew) notifier.offer(reward, stream);
  return true;
};

const noteStream = (row) => {
  const username = handle(row.username);
  if (!username) return;
  const existing = streams.get(username);
  if (existing && existing.viewers >= (row.viewers || 0)) return;
  streams.set(username, {
    username,
    nickname: str(row.nickname, 80) || username,
    title: str(row.title, 160),
    roomId: roomKey(row.roomId),
    viewers: integer(row.viewers),
    region: regionCode(row.region),
    avatar: str(row.avatar, 500),
    thumb: str(row.thumb, 500),
    source: row.source || "previous",
    verifiedAt: new Date().toISOString(),
    openUrl: `https://www.tiktok.com/@${username}/live`,
    deepLink: `snssdk1233://live?room_id=${roomKey(row.roomId)}`,
  });
};

for (let round = 0; round < CHEST_ROUNDS && order.length; round += 1) {
  if (Date.now() > DEADLINE) break;
  const start = (round * MAX_ROOMS) % order.length;
  const slice = [];
  for (let i = 0; i < Math.min(MAX_ROOMS, order.length); i += 1) slice.push(order[(start + i) % order.length]);
  // Sandık görülen odalar her turda taranır; yoksa tur sırası kaydırılır.
  for (const roomId of hotRooms) {
    if (slice.length >= MAX_ROOMS) break;
    const row = order.find((entry) => entry[0] === roomId);
    if (row && !slice.includes(row)) slice.push(row);
  }
  const scannedThisRound = new Set();
  const observedThisRound = new Set();
  await mapLimit(slice, ROOM_CONCURRENCY, async ([roomId, meta]) => {
    if (Date.now() > DEADLINE) return null;
    scannedThisRound.add(roomId);
    const info = await roomInfo(roomId);
    if (!info) return null;
    const stream = {
      username: info.username || meta.username,
      nickname: info.nickname || meta.nickname,
      title: info.title || meta.title,
      roomId,
      viewers: info.viewers || meta.viewers || 0,
      region: info.region || meta.region,
      avatar: info.avatar || meta.avatar,
      thumb: info.thumb,
      source: meta.source,
    };
    noteStream(stream);
    for (const reward of info.rewards) {
      if (applyReward(reward, stream)) observedThisRound.add(reward.envelopeId);
    }
    return null;
  });
  roomsScanned += scannedThisRound.size;
  // Taranan odada görülmeyen sandık "eksik" sayılır; iki tur üst üste
  // görülmezse kapanmış kabul edilir ama süresi doldu diye silinmez.
  for (const [envelopeId, chest] of chests) {
    if (observedThisRound.has(envelopeId)) continue;
    if (!scannedThisRound.has(roomKey(chest.roomId))) continue;
    chest.missingCount = (integer(chest.missingCount) || 0) + 1;
    if (chest.missingCount >= CHEST_MISS_LIMIT && chest.status !== "closed") {
      chest.status = "closed";
      chest.closedAt = new Date().toISOString();
    }
  }
  rounds.push({ round: round + 1, rooms: scannedThisRound.size, chests: observedThisRound.size });
  if (round < CHEST_ROUNDS - 1) {
    await sleep(Math.max(0, Math.min(CHEST_ROUND_GAP_MS, DEADLINE - Date.now())));
  }
}

/* -------------------------------------------------------------------------- */
/*  WebSocket zarflarını sandık listesine işle                                 */
/* -------------------------------------------------------------------------- */

const localWatch = await watchPromise;
// Matris sonucu varsa esas kaynak odur; yoksa yerel dinleyici (matris dışı) kullanılır.
const watch = shardWatch ?? localWatch;
const wsEnvelopes = [];
for (const reward of watch?.envelopes ?? []) {
  let meta = universe.get(reward.roomId);
  if (!obj(meta) || !handle(meta.username)) {
    const info = await roomInfo(reward.roomId);
    if (!info) continue;
    meta = { roomId: reward.roomId, ...info };
    noteRoom(meta);
  }
  const stream = {
    username: meta.username,
    nickname: meta.nickname,
    title: meta.title,
    roomId: reward.roomId,
    viewers: integer(meta.viewers),
    region: meta.region,
    avatar: meta.avatar,
    thumb: "",
    source: "websocket",
  };
  if (!handle(stream.username)) continue;
  if (applyReward(reward, stream)) {
    wsEnvelopes.push(reward.envelopeId);
    noteStream(stream);
  }
}
for (const error of (watch?.errors ?? []).slice(0, 3)) errors.push(error);

// Bekleyen bildirimler yayın yazılmadan önce bitirilir; sonuç tek satırda raporlanır.
const notified = await notifier.settle();
if (notified.sent || notified.failed || notified.skipped) {
  console.log(
    `[arena-radar] zarf bildirimi: ${notified.sent} gönderildi · ${notified.failed} başarısız · ` +
      `${notified.skipped} atlandı (tekrar/sınır/açılışı geçmiş)`,
  );
}

/* -------------------------------------------------------------------------- */
/*  Yayın ve sandık listesi                                                    */
/* -------------------------------------------------------------------------- */

const streamList = [...streams.values()]
  .sort((a, b) => b.viewers - a.viewers)
  .slice(0, MAX_STREAMS)
  .map((row) => ({ ...row, deepLink: `snssdk1233://live?room_id=${row.roomId}` }));

// Devre kesici: ağ tamamen çöktüyse pano boşalmasın, son iyi veri 24 saat
// "stale" işaretiyle yayında kalır.
const degraded = streamList.length === 0 || (errors.length >= 12 && streamList.length < 5);
const keepWindowMs = degraded ? 24 * 60 * 60_000 : 30 * 60_000;
const currentIds = new Set(streamList.map((row) => row.roomId));
for (const old of previous.streams) {
  if (currentIds.has(old.roomId)) continue;
  const verifiedAt = Date.parse(old.verifiedAt || old.detectedAt || 0);
  if (Number.isFinite(verifiedAt) && NOW - verifiedAt < keepWindowMs) {
    streamList.push({ ...old, stale: true });
    currentIds.add(old.roomId);
  }
}

// Üye defteri: doğrulanmış yayıncılar gün gün birikir, hiçbiri silinmez.
const roster = mergeRoster(previousRoster, streamList);

const chestList = [...chests.values()]
  .filter((chest) => {
    const envelopeId = str(chest?.envelopeId, 80);
    if (!envelopeId) return false;
    const seenMs = Date.parse(chest.lastSeenAt || chest.detectedAt || "");
    // Sandık, odada görüldüğü sürece yaşı ne olursa olsun listede kalır.
    if (!Number.isFinite(seenMs) || NOW - seenMs > MAX_CHEST_AGE_MS) return false;
    const closedMs = Date.parse(chest.closedAt || "");
    if (chest.status === "closed" && Number.isFinite(closedMs) && NOW - closedMs > CLOSED_CHEST_KEEP_MS) return false;
    return true;
  })
  .map((chest) => {
    const opensMs = Date.parse(chest.opensAt || "");
    const opensInMs = Number.isFinite(opensMs) ? opensMs - NOW : 0;
    const status = chest.status === "closed" ? "closed" : opensInMs > 0 ? "waiting" : "open";
    return { ...chest, status, secondsLeft: Math.round(opensInMs / 1000) };
  })
  .sort((a, b) => {
    const rank = (row) => (row.status === "waiting" ? 0 : row.status === "open" ? 1 : 2);
    return rank(a) - rank(b) || Date.parse(a.opensAt) - Date.parse(b.opensAt);
  })
  .slice(0, MAX_CHESTS);

// Sağlık özeti: panel ve Windows istemcisi verinin yaşını ve bayat işaretini görür.
const stale = degraded && streamList.length > 0;
const newestVerified = streamList.reduce((latest, row) => {
  const at = Date.parse(row.verifiedAt || "");
  return Number.isFinite(at) && at > latest ? at : latest;
}, 0);
const dataAgeMinutes = newestVerified ? Math.max(0, Math.round((NOW - newestVerified) / 60_000)) : null;
// Dinleme durumu ve imzalama kotası panelde görünür olmalı; uyarılar sessizce
// yutulmaz, `warnings` alanıyla yayınlanır.
// Zarf şeması takibi: bilinmeyen tip ve 24 saat sessizlik, önceki yayının
// `health` kaydıyla karşılaştırılarak raporlanır; ilk çalıştırma tabanı kurar.
const envelopeTypes = envelopeSchemaState(watch?.messageTypes ?? {}, previous.health);
const runAt = envelopeTypes.at;
const wsWarnings =
  shardDir && !shardResults.length
    ? [
        "Matris dinleme artifact'ı bulunamadı: bu turda hiçbir oda WebSocket'ten dinlenmedi. " +
          "Shard işinin loguna bakın.",
      ]
    : envelopeWarnings(watch, {
        rooms: watch?.requested ?? watchRooms.length,
        enabled: Boolean(shardDir) || ENVELOPE_ROOMS > 0,
        seconds: watch?.seconds ?? watchSeconds,
        apiKey: Boolean(process.env.EULER_API_KEY),
        lastSeenAt: envelopeTypes.lastSeenAt,
        trackingSince: envelopeTypes.trackingSince,
        sampleType: envelopeTypes.sampleType,
      });
const wsRateLimited = Boolean(watch?.rateLimited) || (watch?.rateLimitHits ?? 0) > 0;
const health = {
  ok: !stale,
  stale,
  degraded,
  dataAgeMinutes,
  live: streamList.length,
  chests: chestList.length,
  chestsWaiting: chestList.filter((row) => row.status === "waiting").length,
  chestsOpen: chestList.filter((row) => row.status === "open").length,
  letters: chestList.filter((row) => row.kind === "letter").length,
  roomsAlive: aliveIds.size,
  roomsScanned,
  rounds: rounds.length,
  // WebSocket kanıtı: kaç benzersiz odaya bağlanıldı, kaç zarf mesajı çözüldü, kaç zarf okundu.
  wsRooms: watch?.connected ?? 0,
  wsConnectedRooms: watch?.connectedRooms ?? watch?.connected ?? 0,
  wsAttempted: watch?.attempted ?? watch?.connected ?? 0,
  wsEnvelopes: watch?.envelopes.length ?? 0,
  wsMessages: Object.values(watch?.messageTypes ?? {}).reduce((sum, n) => sum + n, 0),
  wsRequested: watch?.requested ?? watchRooms.length,
  wsShards: shardResults.length,
  wsShardCoverage: shardStats,
  wsSignedWithKey: Boolean(watch?.signedWithKey),
  wsRateLimited,
  wsRateLimitHits: watch?.rateLimitHits ?? 0,
  // Kota beklemesi: panel "kota doldu" yerine yeniden deneme anını geri sayar.
  wsCooldownUntil: watch?.cooldownUntil ?? null,
  wsCooldownSeconds: watch?.cooldownSeconds ?? 0,
  wsCooldownWaits: watch?.cooldownWaits ?? 0,
  wsWarnings: wsWarnings.length,
  // Zarf şeması raporu: bilinmeyen tipler ve sessizlik takibi yayınlar arasında taşınır.
  envelopeLastSeenAt: envelopeTypes.lastSeenAt,
  envelopeTrackingSince: envelopeTypes.trackingSince,
  envelopeSampleType: envelopeTypes.sampleType,
  unknownEnvelopeTypes: envelopeTypes.unknown.map((row) => row.type).slice(0, 5),
  errors: errors.length,
  roster: roster.streamers.length,
};

const snapshot = {
  schema: 1,
  source: "github-radar",
  repo: REPO,
  generatedAt: runAt,
  scanSeconds: Math.round((Date.now() - NOW) / 1000),
  nextScanHintSeconds: 600,
  stale,
  dataAgeMinutes,
  health,
  warnings: wsWarnings,
  stats: {
    candidates: candidates.size,
    checked: found.length,
    live: streamList.length,
    chests: chestList.length,
    letters: health.letters,
    chestRounds: rounds.length,
    roomsAlive: aliveIds.size,
    roomsScanned,
    wsRooms: health.wsRooms,
    wsEnvelopes: wsEnvelopes.length,
    wsMessages: health.wsMessages,
    newMembers: roster.isNew.length,
    roster: roster.streamers.length,
    errors: errors.length,
    degraded,
  },
  regions: regionsPicked.map((code) => ({ code, supported: regionCodes.includes(code) })),
  rounds,
  watch: watch
    ? {
        requested: watch.requested ?? watchRooms.length,
        connected: watch.connected,
        connectedRooms: watch.connectedRooms ?? watch.connected,
        attempted: watch.attempted ?? watch.connected,
        failed: watch.failed,
        seconds: watch.seconds,
        envelopes: wsEnvelopes.length,
        rateLimited: Boolean(watch.rateLimited),
        rateLimitHits: watch.rateLimitHits ?? 0,
        signedWithKey: Boolean(watch.signedWithKey),
        cooldownUntil: watch.cooldownUntil ?? null,
        cooldownSeconds: watch.cooldownSeconds ?? 0,
        cooldownWaits: watch.cooldownWaits ?? 0,
        // Shard başına denenen/bağlanan/room-info zarfı çıkan oda sayıları.
        ...(shardStats.length ? { shardCoverage: shardStats } : {}),
        messageTypes: Object.fromEntries(
          Object.entries(watch.messageTypes).sort((a, b) => b[1] - a[1]).slice(0, 12),
        ),
      }
    : null,
  streams: streamList,
  chests: chestList,
  errors: [...new Set(errors)].slice(0, 10),
};

// Sözleşme kontrolü: yayınlanan dosya tüketicilerin beklediği alanları taşıyor mu?
const contractProblems = validateSnapshot(snapshot).map((problem) => `sözleşme: ${problem}`);
if (contractProblems.length) {
  snapshot.errors = [...new Set([...snapshot.errors, ...contractProblems])].slice(0, 10);
  snapshot.health.ok = false;
  console.warn(`[arena-radar] ${contractProblems.length} sözleşme sorunu: ${contractProblems.slice(0, 3).join(" · ")}`);
}

await mkdir(OUT_DIR, { recursive: true });
const tmp = `${OUT_FILE}.tmp`;
await writeFile(tmp, `${JSON.stringify(snapshot, null, 0)}\n`, "utf8");
await rename(tmp, OUT_FILE);
const rosterSnapshot = {
  schema: 1,
  source: "github-radar",
  repo: REPO,
  updatedAt: snapshot.generatedAt,
  total: roster.streamers.length,
  today: roster.today,
  days: Object.entries(roster.days)
    .map(([date, value]) => ({ date, added: integer(obj(value).added), total: integer(obj(value).total) }))
    .sort((a, b) => b.date.localeCompare(a.date)),
  newMembers: roster.isNew.slice(0, 50),
  streamers: roster.streamers,
};
const rosterProblems = validateRoster(rosterSnapshot);
if (rosterProblems.length) {
  console.warn(`[arena-radar] üye defteri sözleşmesi: ${rosterProblems.slice(0, 3).join(" · ")}`);
}
const rosterTmp = `${ROSTER_FILE}.tmp`;
await writeFile(rosterTmp, `${JSON.stringify(rosterSnapshot)}\n`, "utf8");
await rename(rosterTmp, ROSTER_FILE);

const versionPayload = {
  schema: 1,
  dataVersion: snapshot.generatedAt,
  generatedAt: snapshot.generatedAt,
  commit: process.env.GITHUB_SHA || "",
  stale: snapshot.stale,
  dataAgeMinutes: snapshot.dataAgeMinutes,
  health: snapshot.health,
  stats: snapshot.stats,
  roster: { total: roster.streamers.length, today: roster.today.added },
};
const versionTmp = `${VERSION_FILE}.tmp`;
await writeFile(versionTmp, `${JSON.stringify(versionPayload, null, 2)}\n`, "utf8");
await rename(versionTmp, VERSION_FILE);

// Supabase (isteğe bağlı): yeni yayıncılar ve sandık geçmişi kalıcı tablolara yazılır.
const mirrored = await mirrorToSupabase({ roster: rosterSnapshot, snapshot });

console.log(
  `[arena-radar] ${snapshot.stats.live} canlı yayın · ${snapshot.stats.chests} sandık ` +
    `(${health.chestsWaiting} bekliyor · ${health.chestsOpen} açık · ${health.letters} mektup) · ` +
    `${roomsScanned} oda taraması / ${rounds.length} tur · ${snapshot.stats.checked}/${snapshot.stats.candidates} aday doğrulandı · ` +
    `WS ${health.wsRooms} oda / ${health.wsMessages} mesaj / ${health.wsEnvelopes} zarf · ` +
    `üye defteri ${rosterSnapshot.total} (bugün +${roster.today.added}) · ${snapshot.scanSeconds}s`,
);
if (!mirrored.skipped) console.log(`[arena-radar] Supabase: ${mirrored.streamers} yayıncı · ${mirrored.chests} sandık · ${mirrored.errors} hata`);
for (const warning of wsWarnings) console.log(`[arena-radar] WS uyarı: ${warning}`);
for (const error of snapshot.errors) console.log(`[arena-radar] uyarı: ${error}`);
