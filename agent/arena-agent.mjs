#!/usr/bin/env node
/**
 * Arena Local Agent — localhost TikTok LIVE toplayıcı
 * ---------------------------------------------------------------------------
 * Panelden (veya .env'den) sabitlenen yayıncıları okur, tiktok-live-connector ile
 * aynı anda N odayı paralel dinler ve sandık zarfı + hediye jeton akışını
 * panelin /api/ingest ucuna gönderir.
 *
 * Kullanım (proje kökünden):
 *   node agent/arena-agent.mjs
 *   WATCHLIST="@a,@b" CONCURRENCY=6 LISTEN_SECONDS=300 node agent/arena-agent.mjs
 *
 * Ortam değişkenleri:
 *   ARENA_PANEL_URL   http://localhost:3000
 *   ARENA_INGEST_TOKEN  (panel .env ile aynı; opsiyonel)
 *   WATCHLIST         virgülle ayrılmış @kullanici listesi (opsiyonel)
 *   CONCURRENCY       aynı anda dinlenecek oda (varsayılan 5)
 *   LISTEN_SECONDS    her odada dinleme süresi (varsayılan 300)
 *   POLL_SECONDS      panel oda listesini yenileme (varsayılan 60)
 */
import { setTimeout as sleep } from "node:timers/promises";

const PANEL = (process.env.ARENA_PANEL_URL || "http://localhost:3000").replace(/\/$/, "");
const TOKEN = process.env.ARENA_INGEST_TOKEN || "";
const WATCHLIST = (process.env.WATCHLIST || "")
  .split(",")
  .map((item) => item.trim().replace(/^@+/, ""))
  .filter(Boolean);
const CONCURRENCY = Math.max(1, Number(process.env.CONCURRENCY || 5));
const LISTEN_SECONDS = Math.max(20, Number(process.env.LISTEN_SECONDS || 300));
const POLL_SECONDS = Math.max(20, Number(process.env.POLL_SECONDS || 60));

function log(...args) {
  console.log(`[arena-agent ${new Date().toLocaleTimeString("tr-TR")}]`, ...args);
}

async function api(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
  if (TOKEN) headers["x-arena-token"] = TOKEN;
  const response = await fetch(`${PANEL}${path}`, { ...init, headers });
  if (!response.ok) throw new Error(`${path} → HTTP ${response.status}`);
  return response.json();
}

async function ingest(payload) {
  try {
    await api("/api/ingest", { method: "POST", body: JSON.stringify({ source: "local-agent", ...payload }) });
  } catch (error) {
    log("ingest hatası:", error.message);
  }
}

async function fetchTargets() {
  const targets = new Map();
  for (const username of WATCHLIST) targets.set(username.toLowerCase(), { username, viewers: 0 });
  try {
    const data = await api("/api/rooms?live=1&limit=100");
    for (const room of data.data ?? []) {
      targets.set(room.username.toLowerCase(), {
        username: room.username,
        roomId: room.roomId,
        nickname: room.nickname,
        title: room.title,
        viewers: room.viewers,
      });
    }
  } catch (error) {
    log("oda listesi alınamadı:", error.message);
  }
  return [...targets.values()];
}

class Flow {
  constructor(username, meta) {
    this.username = username;
    this.meta = meta;
    this.diamonds = 0;
    this.events = 0;
    this.senders = new Set();
    this.top = new Map();
    this.combo = new Map();
    this.startedAt = Date.now();
    this.lastAt = Date.now();
    this.envelopeId = "";
  }

  gift(user, giftId, diamonds, repeatCount) {
    const value = Number(diamonds || 0);
    if (value <= 0) return 0;
    const count = Number(repeatCount || 0);
    const sender = (user || "?").replace(/^@+/, "");
    const key = `${sender}:${giftId || "?"}`;
    const prev = this.combo.get(key) ?? 0;
    let delta;
    if (count <= 0) delta = 1;
    else if (count <= prev) delta = count;
    else delta = count - prev;
    this.combo.set(key, count);
    const gained = value * Math.max(1, delta);
    this.diamonds += gained;
    this.events += 1;
    this.senders.add(sender);
    this.top.set(sender, (this.top.get(sender) ?? 0) + gained);
    this.lastAt = Date.now();
    return gained;
  }

  snapshot() {
    const seconds = Math.max(1, (Date.now() - this.startedAt) / 1000);
    const top = [...this.top.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      username: this.username,
      roomId: this.meta.roomId || "",
      nickname: this.meta.nickname || this.username,
      title: this.meta.title || "",
      diamonds: this.diamonds,
      events: this.events,
      senders: this.senders.size,
      topSenders: top,
      diamondsPerMin: Math.round((this.diamonds / seconds) * 60),
      watchedSeconds: Math.round(seconds),
      hasEnvelope: Boolean(this.envelopeId),
      envelopeId: this.envelopeId,
      viewers: Number(this.meta.viewers || 0),
    };
  }
}

async function watchRoom(target, TikTokLiveConnection) {
  const username = target.username.replace(/^@+/, "");
  const flow = new Flow(username, target);
  let connection = null;
  try {
    connection = new TikTokLiveConnection(username, {
      processInitialData: false,
      enableExtendedGiftInfo: true,
    });

    connection.on("envelope", (data) => {
      const info = data?.envelopeInfo;
      if (!info) return;
      flow.envelopeId = info.envelopeId || flow.envelopeId;
      log(`🎁 sandık: @${username} · ${info.diamondCount} jeton / ${info.peopleCount} kişi`);
      void ingest({
        type: "chest",
        room: { username, roomId: info.roomId || target.roomId, nickname: target.nickname, title: target.title, viewers: target.viewers },
        chest: {
          envelopeId: info.envelopeId,
          roomId: info.roomId,
          diamondCount: info.diamondCount,
          peopleCount: info.peopleCount,
          unpackAt: info.unpackAt,
          skinId: info.skinId,
          businessType: info.businessType,
        },
      });
      void flush();
    });

    connection.on("gift", (data) => {
      const diamonds = data?.diamondCount ?? data?.giftDetails?.diamondCount ?? data?.giftDetails?.diamond_count ?? 0;
      const gained = flow.gift(
        data?.user?.uniqueId,
        String(data?.giftId ?? data?.giftDetails?.id ?? ""),
        diamonds,
        data?.repeatCount,
      );
      if (gained > 0) log(`💎 jeton: @${username} +${gained} (${data?.giftName ?? data?.giftDetails?.name ?? "hediye"})`);
    });

    connection.on("roomUser", (data) => {
      if (data?.viewerCount) target.viewers = data.viewerCount;
    });

    connection.on("streamEnd", () => {
      log(`yayın bitti: @${username}`);
      void flush();
    });

    const flush = async () => {
      if (flow.diamonds <= 0 && !flow.envelopeId) return;
      await ingest({ type: "flow", flow: flow.snapshot() });
    };

    await connection.connect();
    log(`dinleniyor: @${username} (${LISTEN_SECONDS}s)`);
    const timer = setInterval(() => void flush(), 30000);
    await sleep(LISTEN_SECONDS * 1000);
    clearInterval(timer);
    await flush();
  } catch (error) {
    log(`bağlantı hatası @${username}: ${error.name || ""} ${error.message || error}`);
    await ingest({
      type: "room",
      room: { username, liveNow: false, viewers: 0, roomId: target.roomId },
    });
  } finally {
    try {
      await connection?.disconnect();
    } catch {
      /* zaten kapalı */
    }
  }
}

async function main() {
  let TikTokLiveConnection;
  try {
    ({ TikTokLiveConnection } = await import("tiktok-live-connector"));
  } catch {
    console.error("tiktok-live-connector bulunamadı. Proje kökünde `npm ci` çalıştırın.");
    process.exit(1);
  }
  log(`panel: ${PANEL} · eşzamanlılık: ${CONCURRENCY} · dinleme: ${LISTEN_SECONDS}s`);

  while (true) {
    const targets = await fetchTargets();
    if (targets.length === 0) {
      log("hedef oda yok. Panelde oda sabitleyin veya WATCHLIST verin.");
      await sleep(POLL_SECONDS * 1000);
      continue;
    }
    log(`${targets.length} hedef, ${Math.min(CONCURRENCY, targets.length)} paralel dinlenecek`);
    let index = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, targets.length) }, async () => {
      while (index < targets.length) {
        const current = targets[index];
        index += 1;
        if (current) await watchRoom(current, TikTokLiveConnection);
        await sleep(300);
      }
    });
    await Promise.all(workers);
    log("tur tamamlandı, yeniden taranıyor...");
    await sleep(POLL_SECONDS * 1000);
  }
}

process.on("SIGINT", () => {
  log("kapatıldı");
  process.exit(0);
});

void main();
