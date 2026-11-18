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
let source = "";
let lastFetchAt = 0;
let lastError = "";
let alerts = [];
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

function raiseAlert(chest) {
  const left = secondsLeft(chest);
  const when = left <= 0 ? "şimdi açık" : left < 120 ? `${left} sn sonra` : `${Math.round(left / 60)} dk sonra`;
  const title = `🎁 ${ratioOf(chest)}× oran · @${chest.username}`;
  const message = `${chest.coins} jeton / ${chest.slots} kişi · ${when}`;
  alerts = [...alerts.slice(-24), { id: chest.envelopeId, title, message, at: new Date().toISOString(), username: chest.username, coins: chest.coins, slots: chest.slots, ratio: ratioOf(chest) }];
  notifyDesktop(title, message);
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
      const firstLoad = !snapshot;
      snapshot = data;
      source = url;
      lastFetchAt = Date.now();
      lastError = "";
      const chests = Array.isArray(data.chests) ? data.chests : [];
      if (!seeded) {
        for (const chest of chests) alerted.add(chest.envelopeId);
        seeded = true;
        saveAlerted();
      } else {
        let fresh = 0;
        for (const chest of chests) {
          if (!chest || !chest.envelopeId || alerted.has(chest.envelopeId)) continue;
          alerted.add(chest.envelopeId);
          const left = secondsLeft(chest);
          if (ratioOf(chest) >= Number(config.alertRatio || 7) && left <= Number(config.alertSeconds || 180) && left > -30) {
            raiseAlert(chest);
            fresh += 1;
          }
        }
        if (fresh) saveAlerted();
        else if (alerted.size > 2500) saveAlerted();
      }
      if (firstLoad) log(`veri alındı: ${data.stats ? data.stats.live : 0} yayın · ${chests.length} sandık`);
      return;
    } catch (error) {
      lastFailure = `${url} → ${error && error.message ? error.message : "hata"}`;
    }
  }
  lastError = lastFailure || "Veri alınamadı";
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
  return {
    app: { name: APP.name, version: APP.version, port: config.port, stateDir: STATE_DIR },
    config: {
      pollSeconds: config.pollSeconds,
      alertRatio: config.alertRatio,
      alertSeconds: config.alertSeconds,
      notifyDesktop: config.notifyDesktop,
      sound: config.sound,
      autoUpdate: config.autoUpdate,
      repo: config.repo,
      pagesUrl: config.pagesUrl,
    },
    snapshot,
    source,
    lastFetchAt,
    lastError,
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
    if (req.method === "POST" && url.pathname === "/api/config") {
      const body = await readBody(req);
      const next = { ...config };
      for (const key of ["pollSeconds", "alertRatio", "alertSeconds", "port"]) {
        if (body[key] !== undefined && Number.isFinite(Number(body[key]))) next[key] = Number(body[key]);
      }
      next.pollSeconds = Math.max(3, Math.min(120, next.pollSeconds));
      next.alertSeconds = Math.max(30, Math.min(1800, next.alertSeconds));
      next.alertRatio = Math.max(1, Math.min(100, next.alertRatio));
      for (const key of ["notifyDesktop", "sound", "autoUpdate", "openBrowser"]) {
        if (typeof body[key] === "boolean") next[key] = body[key];
      }
      Object.assign(config, next);
      saveConfig(config);
      schedulePoll();
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
