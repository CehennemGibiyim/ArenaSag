#!/usr/bin/env node
/**
 * Arena Radar — GitHub Actions üzerinde çalışan bağımsız tarayıcı.
 *
 * Panel, PostgreSQL veya kullanıcı oturumu gerektirmez. Kamuya açık TikTok
 * uçlarından aday yayıncıları toplar, canlılığı doğrular ve sandık zarfı
 * verilerini `web/data/arena-live.json` dosyasına yazar. GitHub Pages ve
 * Windows Radar uygulaması bu dosyayı okur.
 *
 * Kullanım:
 *   node scripts/radar-publish.mjs
 *   ARENA_MAX_CHECKS=80 ARENA_REGIONS=TR,US,DE node scripts/radar-publish.mjs
 *
 * Ortam değişkenleri:
 *   ARENA_REGIONS       Virgülle ayrılmış bölge kodları (varsayılan: TR + rotasyon)
 *   ARENA_MAX_CHECKS    Doğrulanacak en fazla aday (varsayılan 80)
 *   ARENA_MAX_ROOMS     Sandık için sorgulanacak en fazla canlı oda (varsayılan 45)
 *   ARENA_MAX_CHEST_AGE Saat cinsinden sandık hafızası (varsayılan 6)
 *   ARENA_STREAMERS     Ek yayıncı listesi (@a,@b)
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "web", "data");
const OUT_FILE = path.join(OUT_DIR, "arena-live.json");
const VERSION_FILE = path.join(OUT_DIR, "version.json");

const REPO = process.env.ARENA_GITHUB_REPO || "CehennemGibiyim/ArenaSag";
const DIRECTORY_URL =
  process.env.ARENA_DIRECTORY_URL ||
  "https://raw.githubusercontent.com/CehennemGibiyim/TikTok/main/site/firsat/data/targets.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";
const MAX_CHECKS = clamp(Number(process.env.ARENA_MAX_CHECKS || 80), 10, 160);
const MAX_ROOMS = clamp(Number(process.env.ARENA_MAX_ROOMS || 45), 5, 120);
const MAX_CHEST_AGE_MS = clamp(Number(process.env.ARENA_MAX_CHEST_AGE || 6), 1, 24) * 3_600_000;
const MAX_CHESTS = 240;
const DEADLINE = Date.now() + 4 * 60_000;
const NOW = Date.now();

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
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  if (ms < NOW - 6 * 3_600_000 || ms > NOW + 24 * 3_600_000) return 0;
  return Math.floor(ms / 1000);
}

async function getJson(url, timeout = 9_000) {
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
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  if (!text) throw new Error("Boş yanıt");
  return JSON.parse(text);
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
  const payload = await getJson(DIRECTORY_URL, 9_000);
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

async function checkAlive(roomIds) {
  const alive = new Map();
  for (let i = 0; i < roomIds.length; i += 50) {
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

function parseEnvelope(raw, fallbackRoomId) {
  const record = obj(raw);
  const info = obj(record.envelopeInfo ?? record.envelope_info ?? record);
  const envelopeId = str(info.envelopeId ?? info.envelope_id, 80);
  const coins = integer(info.diamondCount ?? info.diamond_count);
  const slots = integer(info.peopleCount ?? info.people_count);
  const opensAt = timestampSeconds(info.unpackAt ?? info.unpack_at);
  if (!envelopeId || !coins || !slots || !opensAt) return null;
  const skinId = integer(info.skinId ?? info.skin_id) || 1;
  return {
    envelopeId,
    roomId: roomKey(info.roomId ?? info.room_id) || fallbackRoomId,
    coins,
    slots,
    opensAt,
    skinId,
    businessType: integer(info.businessType ?? info.business_type) || 1,
  };
}

function roomRewards(data, roomId) {
  const rewards = [];
  for (const key of ["envelopeInfo", "envelope_info", "envelopeList", "envelope_list"]) {
    const value = data[key];
    for (const entry of list(value).slice(0, 20)) {
      const parsed = parseEnvelope(entry, roomId);
      if (parsed) rewards.push(parsed);
    }
  }
  return rewards;
}

function variantOf(skinId) {
  if (Number(skinId) === 0) return { kind: "bag", variant: "l0" };
  if (Number(skinId) === 2) return { kind: "chest", variant: "gold" };
  if (Number(skinId) === 3) return { kind: "chest", variant: "hanging" };
  return { kind: "chest", variant: "normal" };
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
    errors.push(`room_info(${roomId}): ${error instanceof Error ? error.message : "hata"}`);
    return null;
  }
}

const errors = [];
const previous = await readPrevious();
const candidates = new Map();

// 1) Önceki taramanın canlı odaları — oda kimlikleri korunur, tekrar arama gerekmez.
for (const stream of previous.streams.slice(0, 30)) {
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
  if (result.status === "fulfilled") for (const row of result.value.slice(0, 10)) addCandidate(candidates, row);
  else errors.push(`tikwm: ${result.reason instanceof Error ? result.reason.message : "hata"}`);
}
// 4) Kamuya açık yayıncı dizini — büyük listeden dönen bir örneklem alınır.
try {
  const rows = await fetchDirectory();
  const offset = rows.length ? Math.floor(NOW / 300_000) % rows.length : 0;
  for (let i = 0; i < Math.min(40, rows.length); i += 1) addCandidate(candidates, rows[(offset + i) % rows.length]);
} catch (error) {
  errors.push(`dizin: ${error instanceof Error ? error.message : "hata"}`);
}
// 5) Elle verilen ek hesaplar.
for (const name of String(process.env.ARENA_STREAMERS || "").split(",")) {
  addCandidate(candidates, { username: name, source: "streamers" });
}

const pool = [...candidates.values()].slice(0, MAX_CHECKS);
const verified = await mapLimit(pool, 4, async (candidate) => {
  if (Date.now() > DEADLINE) return null;
  try {
    const info = await userRoom(candidate.username);
    if (!info) return null;
    return { ...candidate, ...info, username: candidate.username, source: candidate.source };
  } catch (error) {
    errors.push(`user_room(@${candidate.username}): ${error instanceof Error ? error.message : "hata"}`);
    return null;
  }
});

const found = verified.filter(Boolean);
const aliveMap = await checkAlive([...new Set(found.map((row) => row.roomId))]);
const live = found.filter((row) => aliveMap.get(row.roomId) === true);
live.sort((a, b) => (b.status === 2 ? 1 : 0) - (a.status === 2 ? 1 : 0));

const detailed = (
  await mapLimit(live.slice(0, MAX_ROOMS), 4, async (row) => {
    if (Date.now() > DEADLINE) return null;
    const info = await roomInfo(row.roomId);
    if (!info) return null;
    return {
      username: row.username,
      nickname: info.nickname || row.nickname,
      title: info.title || row.title,
      roomId: row.roomId,
      viewers: info.viewers || 0,
      region: info.region || row.region || "",
      avatar: info.avatar || row.avatar || "",
      thumb: info.thumb || "",
      source: row.source,
      rewards: info.rewards,
      verifiedAt: new Date().toISOString(),
    };
  })
).filter(Boolean);

const streams = detailed
  .map(({ rewards, ...stream }) => ({
    ...stream,
    openUrl: `https://www.tiktok.com/@${stream.username}/live`,
    deepLink: `snssdk1233://live?room_id=${stream.roomId}`,
  }))
  .sort((a, b) => b.viewers - a.viewers);

// Geçici kaynak hatasında pano boşalmasın: 30 dakikadan yeni önceki yayınlar korunur.
const currentIds = new Set(streams.map((row) => row.roomId));
for (const old of previous.streams) {
  if (currentIds.has(old.roomId)) continue;
  const verifiedAt = Date.parse(old.verifiedAt || old.detectedAt || 0);
  if (Number.isFinite(verifiedAt) && NOW - verifiedAt < 30 * 60_000) {
    streams.push({ ...old, stale: true });
    currentIds.add(old.roomId);
  }
}

const chests = new Map();
const knownChest = new Map(
  previous.chests
    .filter((chest) => chest && chest.envelopeId)
    .map((chest) => [str(chest.envelopeId, 80), chest]),
);
for (const stream of detailed) {
  for (const reward of stream.rewards) {
    if (reward.roomId && reward.roomId !== stream.roomId) continue;
    const known = knownChest.get(reward.envelopeId);
    const opensAt = new Date(reward.opensAt * 1000);
    const secondsLeft = Math.round((opensAt.getTime() - NOW) / 1000);
    if (secondsLeft < -90 || secondsLeft > 24 * 60 * 60) continue;
    const { kind, variant } = variantOf(reward.skinId);
    chests.set(reward.envelopeId, {
      envelopeId: reward.envelopeId,
      kind,
      variant,
      skinId: reward.skinId,
      businessType: reward.businessType,
      username: stream.username,
      nickname: stream.nickname,
      title: stream.title,
      roomId: stream.roomId,
      coins: reward.coins,
      slots: reward.slots,
      ratio: Math.round((reward.coins / Math.max(1, reward.slots)) * 100) / 100,
      viewers: stream.viewers,
      opensAt: opensAt.toISOString(),
      detectedAt: known?.detectedAt || new Date().toISOString(),
      openUrl: stream.openUrl,
      deepLink: stream.deepLink,
    });
  }
}
// Bu turda görülmeyen ama süresi dolmamış sandıklar listede kalır.
for (const chest of previous.chests) {
  const envelopeId = str(chest?.envelopeId, 80);
  if (!envelopeId || chests.has(envelopeId)) continue;
  const opensMs = Date.parse(chest.opensAt || "");
  const detectedMs = Date.parse(chest.detectedAt || "");
  if (!Number.isFinite(opensMs) || opensMs < NOW - 90_000) continue;
  if (!Number.isFinite(detectedMs) || NOW - detectedMs > MAX_CHEST_AGE_MS) continue;
  chests.set(envelopeId, chest);
}
const chestList = [...chests.values()]
  .sort((a, b) => Date.parse(a.opensAt) - Date.parse(b.opensAt))
  .slice(0, MAX_CHESTS);

const snapshot = {
  schema: 1,
  source: "github-radar",
  repo: REPO,
  generatedAt: new Date().toISOString(),
  scanSeconds: Math.round((Date.now() - NOW) / 1000),
  nextScanHintSeconds: 300,
  stats: {
    candidates: candidates.size,
    checked: found.length,
    live: streams.length,
    chests: chestList.length,
    errors: errors.length,
  },
  regions: regionsPicked.map((code) => ({ code, supported: regionCodes.includes(code) })),
  streams,
  chests: chestList,
  errors: [...new Set(errors)].slice(0, 10),
};

await mkdir(OUT_DIR, { recursive: true });
const tmp = `${OUT_FILE}.tmp`;
await writeFile(tmp, `${JSON.stringify(snapshot, null, 0)}\n`, "utf8");
await rename(tmp, OUT_FILE);
const versionPayload = {
  schema: 1,
  dataVersion: snapshot.generatedAt,
  generatedAt: snapshot.generatedAt,
  commit: process.env.GITHUB_SHA || "",
  stats: snapshot.stats,
};
const versionTmp = `${VERSION_FILE}.tmp`;
await writeFile(versionTmp, `${JSON.stringify(versionPayload, null, 2)}\n`, "utf8");
await rename(versionTmp, VERSION_FILE);

console.log(
  `[arena-radar] ${snapshot.stats.live} canlı yayın · ${snapshot.stats.chests} sandık · ` +
    `${snapshot.stats.checked}/${snapshot.stats.candidates} aday doğrulandı · ${snapshot.scanSeconds}s`,
);
for (const error of snapshot.errors) console.log(`[arena-radar] uyarı: ${error}`);
