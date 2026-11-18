#!/usr/bin/env node
/**
 * Arena Radar — Windows masaüstü istemcisi.
 *
 * - GitHub Radar'ın yayınladığı `web/data/arena-live.json` dosyasını 5 saniyede
 *   bir çeker (raw.githubusercontent + GitHub Pages yedeği).
 * - Sandık açılmadan önce Windows bildirimi gönderir.
 * - Açılışta GitHub sürümünü denetler; yeni kurulum paketini indirip uygular.
 * - Yerel panoyu http://127.0.0.1:4817 adresinde sunar.
 *
 * Bağımlılık yoktur. Node.js 20+ (kurulum paketinde gömülü node.exe bulunur).
 *
 * Kullanım:
 *   node desktop/main.mjs            # panoyu açar
 *   node desktop/main.mjs --silent   # tarayıcı açmadan arka planda çalışır
 */
import http from "node:http";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const APP_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(APP_DIR);
const SILENT = process.argv.includes("--silent");
const IS_WIN = process.platform === "win32";

const STATE_DIR =
  process.env.ARENA_RADAR_HOME ||
  (IS_WIN
    ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "ArenaRadar")
    : path.join(os.homedir(), ".arena-radar"));
const SCANNER = path.join(ROOT, "scripts", "radar-publish.mjs");
const DISCOVERY_DIR = path.join(STATE_DIR, "data");
const CONFIG_FILE = path.join(STATE_DIR, "config.json");
const ALERTED_FILE = path.join(STATE_DIR, "alerted.json");
const LOG_FILE = path.join(STATE_DIR, "radar.log");
const PID_FILE = path.join(STATE_DIR, "radar.pid");
const UPDATE_DIR = path.join(STATE_DIR, "updates");

const DEFAULTS = {
  repo: "CehennemGibiyim/ArenaSag",
  dataUrls: [
    "https://raw.githubusercontent.com/CehennemGibiyim/ArenaSag/main/web/data/arena-live.json",
    "https://cehennemgibiyim.github.io/ArenaSag/data/arena-live.json",
  ],
  pagesUrl: "https://cehennemgibiyim.github.io/ArenaSag/",
  pollSeconds: 5,
  alertRatio: 7,
  alertSeconds: 180,
  roomScanSeconds: 20,
  roomScanLimit: 8,
  discoverMinutes: 5,
  discoverChecks: 60,
  discoverRooms: 25,
  notifyDesktop: true,
  sound: true,
  autoUpdate: true,
  openBrowser: true,
  port: 4817,
};

const APP = readVersion(path.join(ROOT, "version.json"));

function readVersion(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    return { name: data.name || "Arena Radar", version: data.version || "1.0.0" };
  } catch {
    return { name: "Arena Radar", version: "1.0.0" };
  }
}

function log(...args) {
  const line = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, `${line}\n`);
  } catch {
    /* günlük yazılamazsa sessiz geç */
  }
}

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    return { ...DEFAULTS, ...raw, dataUrls: Array.isArray(raw.dataUrls) && raw.dataUrls.length ? raw.dataUrls : DEFAULTS.dataUrls };
  } catch {
    return { ...DEFAULTS };
  }
}

function saveConfig(next) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`);
}

function loadAlerted() {
  try {
    const rows = JSON.parse(fs.readFileSync(ALERTED_FILE, "utf8"));
    return new Set(Array.isArray(rows) ? rows.slice(-2000) : []);
  } catch {
    return new Set();
  }
}

function saveAlerted() {
  try {
    fs.writeFileSync(ALERTED_FILE, JSON.stringify([...alerted].slice(-2000)));
  } catch {
    /* önemsiz */
  }
}

function compareVersions(a, b) {
  const pa = String(a || "0").replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  const pb = String(b || "0").replace(/^v/, "").split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

const config = loadConfig();
let snapshot = null;
let remoteSnapshot = null;
let localSnapshot = null;
let source = "";
let lastFetchAt = 0;
let lastError = "";
let alerts = [];
const localChests = new Map();
let roomScanTimer;
let discoveryTimer;
let discovery = {
  running: false,
  lastRunAt: null,
  lastLocalAt: null,
  nextAt: null,
  streams: 0,
  chests: 0,
  error: null,
};
let alerted = loadAlerted();
let seeded = alerted.size > 0;
let pollTimer;
let updateTimer;
let versionTimer;
let remoteVersion = null;
let updateState = {
  current: APP.version,
  latest: null,
  available: false,
  ready: false,
  url: null,
  name: null,
  installing: false,
  checkedAt: null,
  error: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36";

function integer(value) {
  const n = typeof value === "string" && value.trim() ? Number(value) : value;
  return typeof n === "number" && Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function timestampSeconds(value) {
  const raw = typeof value === "string" ? Number(value) : value;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  const ms = raw < 1e12 ? raw * 1000 : raw;
  if (ms < Date.now() - 6 * 3_600_000 || ms > Date.now() + 24 * 3_600_000) return 0;
  return Math.floor(ms / 1000);
}

/** room/info yanıtındaki açık zarf alanlarını okur; tahmin üretmez. */
function roomRewards(data, roomId) {
  const rewards = [];
  for (const key of ["envelopeInfo", "envelope_info", "envelopeList", "envelope_list"]) {
    const value = data[key];
    const entries = Array.isArray(value) ? value.slice(0, 20) : value ? [value] : [];
    for (const entry of entries) {
      const info = entry && typeof entry === "object" ? (entry.envelopeInfo || entry.envelope_info || entry) : null;
      if (!info) continue;
      const envelopeId = info.envelopeId || info.envelope_id;
      const coins = integer(info.diamondCount ?? info.diamond_count);
      const slots = integer(info.peopleCount ?? info.people_count);
      const opens = timestampSeconds(info.unpackAt ?? info.unpack_at);
      if (!envelopeId || !coins || !slots || !opens) continue;
      rewards.push({ envelopeId: String(envelopeId), coins, slots, opensAt: new Date(opens * 1000).toISOString(), skinId: integer(info.skinId ?? info.skin_id) || 1 });
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

async function getJson(url, timeout = 9000) {
  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": `ArenaRadar/${APP.version}` },
    cache: "no-store",
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function secondsLeft(chest) {
  const opens = Date.parse(chest && chest.opensAt ? chest.opensAt : "");
  return Number.isFinite(opens) ? Math.round((opens - Date.now()) / 1000) : 0;
}

function ratioOf(chest) {
  const value = Number(chest && chest.ratio);
  if (Number.isFinite(value) && value > 0) return value;
  return Math.round((Number(chest && chest.coins ? chest.coins : 0) / Math.max(1, Number(chest && chest.slots ? chest.slots : 1))) * 100) / 100;
}

function notifyDesktop(title, message) {
  if (!config.notifyDesktop) return;
  const script = path.join(APP_DIR, "notify.ps1");
  if (IS_WIN && fs.existsSync(script)) {
    try {
      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Title", title, "-Message", message],
        { windowsHide: true, detached: true, stdio: "ignore" },
      );
      child.unref();
      return;
    } catch (error) {
      log("bildirim hatası:", error.message);
    }
  }
  log("BİLDİRİM:", title, "-", message);
}

function processChests(chests, options = {}) {
  let fresh = 0;
  for (const chest of chests) {
    const id = chest && chest.envelopeId;
    if (!id || alerted.has(id)) continue;
    alerted.add(id);
    if (options.seedOnly) continue;
    const left = secondsLeft(chest);
    const ratio = ratioOf(chest);
    const inWindow = left > -30 && (options.immediate ? true : left <= Number(config.alertSeconds || 180));
    if (ratio >= Number(config.alertRatio || 7) && inWindow) {
      raiseAlert(chest);
      fresh += 1;
    }
  }
  if (fresh) saveAlerted();
  else if (alerted.size > 2500) saveAlerted();
  return fresh;
}

function raiseAlert(chest) {
  const left = secondsLeft(chest);
  const when = left <= 0 ? "şimdi açık" : left < 120 ? `${left} sn sonra` : `${Math.round(left / 60)} dk sonra`;
  const title = `🎁 ${ratioOf(chest)}× oran · @${chest.username}`;
  const message = `${chest.coins} jeton / ${chest.slots} kişi · ${when}`;
  alerts = [...alerts.slice(-24), { id: chest.envelopeId, title, message, at: new Date().toISOString(), username: chest.username, coins: chest.coins, slots: chest.slots, ratio: ratioOf(chest) }];
  notifyDesktop(title, message);
}

/** GitHub taraması ile yerel keşif turunu tek görünümde birleştirir. */
function mergeSnapshots(remote, local) {
  const timeOf = (value) => (value && value.generatedAt ? Date.parse(value.generatedAt) || 0 : 0);
  const base = timeOf(local) > timeOf(remote) ? local : remote;
  if (!base) return null;

  const streams = new Map();
  for (const item of [...((remote && remote.streams) || []), ...((local && local.streams) || [])]) {
    if (item && item.username) streams.set(item.username, item);
  }
  const chests = new Map();
  for (const item of [...((remote && remote.chests) || []), ...((local && local.chests) || [])]) {
    if (item && item.envelopeId) chests.set(item.envelopeId, item);
  }
  for (const [id, chest] of localChests) chests.set(id, chest);

  const now = Date.now();
  const chestList = [...chests.values()].filter((chest) => {
    const opens = Date.parse((chest && chest.opensAt) || "");
    return Number.isFinite(opens) && opens > now - 10 * 60_000;
  });

  return {
    ...base,
    source: base === local ? "local-discovery" : base.source,
    streams: [...streams.values()],
    chests: chestList,
    stats: {
      ...(base.stats || {}),
      candidates: Math.max(Number(remote?.stats?.candidates) || 0, Number(local?.stats?.candidates) || 0),
      live: streams.size,
      chests: chestList.length,
    },
  };
}

function applySnapshots() {
  snapshot = mergeSnapshots(remoteSnapshot, localSnapshot);
}

/** Paketteki tarayıcıyı kendi IP'mizden çalıştırır; GitHub cron'unu beklemez. */
async function runDiscovery() {
  if (discovery.running) return;
  if (!fs.existsSync(SCANNER)) {
    discovery = { ...discovery, running: false, error: "Tarayıcı betiği pakette bulunamadı." };
    return;
  }
  discovery = { ...discovery, running: true, lastRunAt: new Date().toISOString(), error: null };
  log("yerel keşif turu başladı");
  try {
    await fsp.mkdir(DISCOVERY_DIR, { recursive: true });
    const outFile = path.join(DISCOVERY_DIR, "arena-live.json");
    const checks = Math.max(20, Math.min(120, Number(config.discoverChecks) || 60));
    const rooms = Math.max(10, Math.min(60, Number(config.discoverRooms) || 25));
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [SCANNER], {
        cwd: ROOT,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ARENA_OUT_DIR: DISCOVERY_DIR,
          ARENA_MAX_CHECKS: String(checks),
          ARENA_MAX_ROOMS: String(rooms),
          ARENA_GITHUB_REPO: config.repo,
        },
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("keşif turu 4 dakikada bitmedi"));
      }, 240_000);
      child.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk.toString()).slice(-4000);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(stdout);
        else reject(new Error(`tarayıcı çıkış ${code}${stderr ? `: ${stderr.trim().slice(-180)}` : ""}`));
      });
    });
    const data = JSON.parse(await fsp.readFile(path.join(DISCOVERY_DIR, "arena-live.json"), "utf8"));
    if (!data || data.schema !== 1) throw new Error("yerel veri biçimi geçersiz");
    localSnapshot = data;
    applySnapshots();
    const chests = Array.isArray(data.chests) ? data.chests : [];
    if (!seeded) {
      seeded = true;
      processChests(chests, { seedOnly: true });
    } else {
      processChests(chests);
    }
    discovery = {
      ...discovery,
      running: false,
      lastLocalAt: data.generatedAt || new Date().toISOString(),
      streams: (data.streams || []).length,
      chests: chests.length,
      error: null,
    };
    log(`yerel keşif: ${(data.streams || []).length} canlı yayın · ${chests.length} sandık`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    discovery = { ...discovery, running: false, error: message };
    log("keşif hatası:", message);
  }
}

function scheduleDiscovery(immediate = false) {
  clearTimeout(discoveryTimer);
  const minutes = Math.max(2, Math.min(60, Number(config.discoverMinutes) || 5));
  const delay = immediate ? 1200 : minutes * 60_000;
  discovery = { ...discovery, nextAt: new Date(Date.now() + delay).toISOString() };
  discoveryTimer = setTimeout(async () => {
    await runDiscovery();
    scheduleDiscovery();
  }, delay);
}

async function fetchSnapshot() {
  const urls = Array.isArray(config.dataUrls) && config.dataUrls.length ? config.dataUrls : DEFAULTS.dataUrls;
  let lastFailure = "";
  for (const url of urls) {
    try {
      const separator = url.includes("?") ? "&" : "?";
      const response = await fetch(`${url}${separator}t=${Date.now()}`, {
        headers: { Accept: "application/json", "User-Agent": `ArenaRadar/${APP.version}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      if (!data || data.schema !== 1) throw new Error("Bilinmeyen veri biçimi");
      const firstLoad = !remoteSnapshot;
      remoteSnapshot = data;
      applySnapshots();
      source = url;
      lastFetchAt = Date.now();
      lastError = "";
      const chests = Array.isArray(snapshot && snapshot.chests) ? snapshot.chests : [];
      if (!seeded) {
        seeded = true;
        processChests(chests, { seedOnly: true });
      } else {
        processChests(chests);
      }
      if (firstLoad) log(`veri alındı: ${data.stats ? data.stats.live : 0} yayın · ${chests.length} sandık`);
      return;
    } catch (error) {
      lastFailure = `${url} → ${error && error.message ? error.message : "hata"}`;
    }
  }
  lastError = lastFailure || "Veri alınamadı";
}

async function mapLimit(items, limit, fn) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) await fn(items[index++]);
    }),
  );
}

/** GitHub taramasını beklemeden canlı odaların zarf bilgisini kendi IP'mizden yoklar. */
async function scanRooms() {
  if (!snapshot || !Array.isArray(snapshot.streams)) return;
  const limit = Math.max(1, Math.min(20, Number(config.roomScanLimit) || 8));
  const streams = snapshot.streams.filter((stream) => stream && stream.roomId).slice(0, limit);
  const now = Date.now();
  for (const [id, chest] of localChests) {
    const opens = Date.parse(chest.opensAt || "");
    if (Number.isFinite(opens) && opens < now - 10 * 60_000) localChests.delete(id);
  }
  await mapLimit(streams, 2, async (stream) => {
    try {
      const url = `https://webcast.tiktok.com/webcast/room/info/?aid=1988&room_id=${encodeURIComponent(stream.roomId)}`;
      const response = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/json", Referer: "https://www.tiktok.com/live" },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return;
      const payload = await response.json();
      const data = payload && payload.data ? payload.data : {};
      for (const reward of roomRewards(data, stream.roomId)) {
        const left = Math.round((Date.parse(reward.opensAt) - Date.now()) / 1000);
        if (left < -90 || left > 24 * 60 * 60) continue;
        const kind = variantOf(reward.skinId);
        const chest = {
          envelopeId: reward.envelopeId,
          kind: kind.kind,
          variant: kind.variant,
          skinId: reward.skinId,
          username: stream.username,
          nickname: stream.nickname,
          title: stream.title,
          roomId: stream.roomId,
          coins: reward.coins,
          slots: reward.slots,
          ratio: Math.round((reward.coins / Math.max(1, reward.slots)) * 100) / 100,
          viewers: stream.viewers,
          opensAt: reward.opensAt,
          detectedAt: localChests.get(reward.envelopeId)?.detectedAt || new Date().toISOString(),
          openUrl: stream.openUrl || `https://www.tiktok.com/@${stream.username}/live`,
        };
        const known = localChests.has(reward.envelopeId);
        localChests.set(reward.envelopeId, chest);
        if (!known && processChests([chest], { immediate: true })) {
          log(`yerel sandık: @${stream.username} · ${chest.coins} jeton / ${chest.slots} kişi`);
        }
      }
    } catch {
      /* oda bilgisi alınamadı; sonraki turda tekrar denenir */
    }
  });
}

function scheduleRoomScan() {
  clearTimeout(roomScanTimer);
  const seconds = Math.max(10, Math.min(300, Number(config.roomScanSeconds) || 20));
  roomScanTimer = setTimeout(async () => {
    await scanRooms();
    scheduleRoomScan();
  }, seconds * 1000);
}

function mergedChests() {
  const map = new Map();
  for (const chest of (snapshot && snapshot.chests) || []) {
    if (chest && chest.envelopeId) map.set(chest.envelopeId, chest);
  }
  for (const chest of localChests.values()) map.set(chest.envelopeId, chest);
  return [...map.values()].sort((a, b) => Date.parse(a.opensAt || 0) - Date.parse(b.opensAt || 0));
}

function schedulePoll() {
  clearTimeout(pollTimer);
  const seconds = Math.max(3, Math.min(120, Number(config.pollSeconds) || 5));
  pollTimer = setTimeout(async () => {
    await fetchSnapshot();
    schedulePoll();
  }, seconds * 1000);
}

async function downloadUpdate() {
  if (!updateState.url || updateState.ready || updateState.installing) return;
  try {
    await fsp.mkdir(UPDATE_DIR, { recursive: true });
    const name = updateState.name || "ArenaRadar-Setup.exe";
    const target = path.join(UPDATE_DIR, name);
    const partial = `${target}.part`;
    log(`güncelleme indiriliyor: ${name}`);
    const response = await fetch(updateState.url, {
      headers: { "User-Agent": `ArenaRadar/${APP.version}` },
      signal: AbortSignal.timeout(180_000),
    });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(partial));
    await fsp.rename(partial, target);
    updateState = { ...updateState, ready: true, path: target };
    log(`güncelleme hazır: ${target}`);
  } catch (error) {
    updateState = { ...updateState, error: error instanceof Error ? error.message : "İndirilemedi" };
    log("güncelleme indirme hatası:", updateState.error);
  }
}

async function checkUpdate(force = false) {
  if (updateState.installing) return;
  const now = Date.now();
  if (!force && updateState.checkedAt && now - Date.parse(updateState.checkedAt) < 10 * 60_000) return;
  try {
    const release = await getJson(`https://api.github.com/repos/${config.repo}/releases/latest`, 12_000);
    const latest = String(release.tag_name || "").replace(/^v/, "");
    const assets = Array.isArray(release.assets) ? release.assets : [];
    const stable = assets.find((asset) => /ArenaRadar-Setup\.exe$/i.test(asset.name || ""));
    const versioned = assets.find((asset) => /ArenaRadar-Setup-.*\.exe$/i.test(asset.name || ""));
    const asset = stable || versioned;
    const available = latest ? compareVersions(latest, APP.version) > 0 : false;
    updateState = {
      ...updateState,
      latest: latest || null,
      available,
      url: asset ? asset.browser_download_url : null,
      name: asset ? asset.name : null,
      notes: release.body ? String(release.body).slice(0, 1500) : null,
      checkedAt: new Date().toISOString(),
      error: null,
    };
    if (available && config.autoUpdate && updateState.url && !updateState.ready) void downloadUpdate();
  } catch (error) {
    updateState = { ...updateState, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : "Sürüm denetlenemedi" };
  }
}

async function checkRemoteVersion() {
  try {
    const remote = await getJson(`https://raw.githubusercontent.com/${config.repo}/main/version.json`, 8000);
    remoteVersion = remote && remote.version ? String(remote.version) : null;
    if (remoteVersion && compareVersions(remoteVersion, APP.version) > 0 && !updateState.available) {
      updateState = { ...updateState, latest: remoteVersion, available: true, checkedAt: new Date().toISOString() };
      void checkUpdate(true);
    }
  } catch {
    /* ham dosya okunamazsa sorun değil */
  }
}

function scheduleUpdateChecks() {
  clearInterval(updateTimer);
  clearInterval(versionTimer);
  updateTimer = setInterval(() => void checkUpdate(false), 10 * 60_000);
  versionTimer = setInterval(() => void checkRemoteVersion(), 60_000);
}

function openExternal(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (!["https:", "http:"].includes(parsed.protocol)) return false;
  try {
    if (IS_WIN) spawn("cmd", ["/c", "start", "", parsed.href], { windowsHide: true, detached: true, stdio: "ignore" }).unref();
    else if (process.platform === "darwin") spawn("open", [parsed.href], { detached: true, stdio: "ignore" }).unref();
    else spawn("xdg-open", [parsed.href], { detached: true, stdio: "ignore" }).unref();
    return true;
  } catch {
    return false;
  }
}

async function applyUpdate() {
  if (!updateState.ready || !updateState.path) return { ok: false, error: "Güncelleme dosyası hazır değil." };
  const script = path.join(APP_DIR, "apply-update.ps1");
  if (!IS_WIN || !fs.existsSync(script)) return { ok: false, error: "Otomatik kurulum yalnızca Windows'ta desteklenir." };
  updateState = { ...updateState, installing: true };
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Installer", updateState.path],
    { windowsHide: true, detached: true, stdio: "ignore" },
  );
  child.unref();
  setTimeout(() => shutdown(0), 800);
  return { ok: true };
}

function statePayload() {
  const generated = snapshot && snapshot.generatedAt ? Date.parse(snapshot.generatedAt) : NaN;
  const chests = mergedChests();
  return {
    app: { name: APP.name, version: APP.version, port: config.port, stateDir: STATE_DIR },
    config: {
      pollSeconds: config.pollSeconds,
      alertRatio: config.alertRatio,
      alertSeconds: config.alertSeconds,
      roomScanSeconds: config.roomScanSeconds,
      roomScanLimit: config.roomScanLimit,
      discoverMinutes: config.discoverMinutes,
      discoverChecks: config.discoverChecks,
      discoverRooms: config.discoverRooms,
      notifyDesktop: config.notifyDesktop,
      sound: config.sound,
      autoUpdate: config.autoUpdate,
      repo: config.repo,
      pagesUrl: config.pagesUrl,
    },
    snapshot: snapshot ? { ...snapshot, chests, stats: { ...(snapshot.stats || {}), chests: chests.length } } : null,
    source,
    lastFetchAt,
    lastError,
    discovery: {
      ...discovery,
      scanner: fs.existsSync(SCANNER),
      localAt: localSnapshot ? localSnapshot.generatedAt : null,
      localStreams: localSnapshot ? (localSnapshot.streams || []).length : 0,
      localChests: localSnapshot ? (localSnapshot.chests || []).length : 0,
    },
    dataAgeSeconds: Number.isFinite(generated) ? Math.max(0, Math.round((Date.now() - generated) / 1000)) : null,
    alerts: alerts.slice(-10),
    update: updateState,
    remoteVersion,
  };
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_000) throw new Error("İstek çok büyük");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://127.0.0.1:${config.port}`);
  try {
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      const html = await fsp.readFile(path.join(APP_DIR, "ui", "index.html"));
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/state") {
      json(res, 200, statePayload());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/refresh") {
      await fetchSnapshot();
      json(res, 200, statePayload());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/discover") {
      void runDiscovery();
      await sleep(300);
      json(res, 200, { ok: true, discovery });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/config") {
      const body = await readBody(req);
      const next = { ...config };
      for (const key of ["pollSeconds", "alertRatio", "alertSeconds", "roomScanSeconds", "roomScanLimit", "discoverMinutes", "discoverChecks", "discoverRooms", "port"]) {
        if (body[key] !== undefined && Number.isFinite(Number(body[key]))) next[key] = Number(body[key]);
      }
      next.pollSeconds = Math.max(3, Math.min(120, next.pollSeconds));
      next.alertSeconds = Math.max(30, Math.min(1800, next.alertSeconds));
      next.alertRatio = Math.max(1, Math.min(100, next.alertRatio));
      next.roomScanSeconds = Math.max(10, Math.min(300, next.roomScanSeconds));
      next.roomScanLimit = Math.max(1, Math.min(20, next.roomScanLimit));
      next.discoverMinutes = Math.max(2, Math.min(60, next.discoverMinutes));
      next.discoverChecks = Math.max(20, Math.min(120, next.discoverChecks));
      next.discoverRooms = Math.max(10, Math.min(60, next.discoverRooms));
      for (const key of ["notifyDesktop", "sound", "autoUpdate", "openBrowser"]) {
        if (typeof body[key] === "boolean") next[key] = body[key];
      }
      Object.assign(config, next);
      saveConfig(config);
      schedulePoll();
      scheduleRoomScan();
      scheduleDiscovery();
      json(res, 200, statePayload());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/test-alert") {
      raiseAlert({ envelopeId: `test-${Date.now()}`, username: "arena_test", coins: 500, slots: 20, ratio: 25, opensAt: new Date(Date.now() + 60_000).toISOString() });
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/update/check") {
      await checkUpdate(true);
      json(res, 200, updateState);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/update/apply") {
      json(res, 200, await applyUpdate());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/open") {
      const body = await readBody(req);
      json(res, 200, { ok: openExternal(String(body.url || "")) });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/quit") {
      json(res, 200, { ok: true });
      setTimeout(() => shutdown(0), 200);
      return;
    }
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bulunamadı");
  } catch (error) {
    json(res, 500, { error: error instanceof Error ? error.message : "Sunucu hatası" });
  }
});

function shutdown(code) {
  try {
    fs.unlinkSync(PID_FILE);
  } catch {
    /* zaten yok */
  }
  server.close(() => process.exit(code));
  setTimeout(() => process.exit(code), 700);
}

async function alreadyRunning() {
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/api/state`, { signal: AbortSignal.timeout(900) });
    if (!response.ok) return false;
    const data = await response.json();
    return Boolean(data && data.app && data.app.name === APP.name);
  } catch {
    return false;
  }
}

async function main() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.mkdirSync(UPDATE_DIR, { recursive: true });

  if (await alreadyRunning()) {
    log("uygulama zaten çalışıyor; pano açılıyor.");
    if (!SILENT) openExternal(`http://127.0.0.1:${config.port}/`);
    process.exit(0);
  }

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });
  fs.writeFileSync(PID_FILE, String(process.pid));
  log(`${APP.name} ${APP.version} · http://127.0.0.1:${config.port}`);

  await fetchSnapshot();
  schedulePoll();
  void scanRooms();
  scheduleRoomScan();
  scheduleDiscovery(true);
  void checkRemoteVersion();
  void checkUpdate(true);
  scheduleUpdateChecks();

  if (!SILENT && config.openBrowser) {
    await sleep(350);
    openExternal(`http://127.0.0.1:${config.port}/`);
  }
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("uncaughtException", (error) => log("beklenmeyen hata:", error && error.stack ? error.stack : String(error)));

main().catch((error) => {
  log("başlatılamadı:", error && error.message ? error.message : String(error));
  process.exit(1);
});
