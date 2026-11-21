import type { RadarWatch } from "@/lib/radar-watch";
import { bumpRoomChest, upsertLiveRoom } from "@/server/rooms";
import { deriveChest, recordChest } from "@/server/chest";
import { sendNotification } from "@/server/notify";

/**
 * Radar köprüsü — GitHub Radar'ın `arena-live.json` dosyasını PostgreSQL'e aktarır.
 *
 * Üye defteri aktarımı yalnızca yayıncı listesini taşır; panelin "doğrulanmış
 * yayınlar" ve sandık listeleri radarın gerçek tarama çıktısından beslenmiyordu.
 * Bu modül doğrulanmış canlı odaları `live_rooms`, sandık zarflarını `chests`
 * tablosuna yazar. Radar verisi `stale` işaretliyse odalar canlı sayılmaz.
 */

const REPO = process.env.ARENA_GITHUB_REPO || "CehennemGibiyim/ArenaSag";
const DATA_BRANCH = process.env.ARENA_DATA_BRANCH || "data";
const SOURCE = "github-radar";
const MAX_STREAMS = 120;
const MAX_CHESTS = 240;
const INTERVAL_MS = 10 * 60_000;

type RadarStream = {
  username?: string;
  nickname?: string;
  title?: string;
  avatar?: string;
  roomId?: string;
  region?: string;
  viewers?: number;
  stale?: boolean;
  verifiedAt?: string;
};

type RadarChest = {
  envelopeId?: string;
  roomId?: string;
  username?: string;
  nickname?: string;
  title?: string;
  coins?: number;
  slots?: number;
  skinId?: number;
  businessType?: number;
  opensAt?: string;
  viewers?: number;
};

type RadarPayload = {
  schema?: number;
  generatedAt?: string;
  stale?: boolean;
  streams?: RadarStream[];
  chests?: RadarChest[];
  watch?: Partial<RadarWatch> | null;
  warnings?: unknown;
};

export type RadarSyncResult = {
  ok: boolean;
  fetched: number;
  rooms: number;
  live: number;
  chests: number;
  stale: boolean;
  syncedAt: string;
  error?: string;
  // WebSocket zarf dinlemesi; panel sandık radarı sekmesinde gösterir.
  watch: RadarWatch | null;
  warnings: string[];
};

/** `watch` alanını eksik/bozuk değerlere karşı güvenli sayılara indirger. */
function readWatch(value: unknown): RadarWatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<RadarWatch>;
  return {
    requested: Number(row.requested ?? 0) || 0,
    connected: Number(row.connected ?? 0) || 0,
    failed: Number(row.failed ?? 0) || 0,
    seconds: Number(row.seconds ?? 0) || 0,
    envelopes: Number(row.envelopes ?? 0) || 0,
    rateLimited: row.rateLimited === true,
    rateLimitHits: Number(row.rateLimitHits ?? 0) || 0,
    signedWithKey: row.signedWithKey === true,
  };
}

function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
}

const state = globalThis as typeof globalThis & {
  __arenaRadarSyncTimer?: ReturnType<typeof setTimeout | typeof setInterval>;
  __arenaRadarLast?: RadarSyncResult | null;
  __arenaRadarStale?: boolean;
};

export function radarSnapshotUrl() {
  return `https://raw.githubusercontent.com/${REPO}/${DATA_BRANCH}/web/data/arena-live.json`;
}

export function lastRadarSync(): RadarSyncResult | null {
  return state.__arenaRadarLast ?? null;
}

/** Panelli doğrudan `arena-live.json`'dan okuyan uç için özet. */
export type RadarWatchSnapshot = {
  ok: boolean;
  watch: RadarWatch | null;
  warnings: string[];
  generatedAt: string | null;
  stale: boolean;
  error?: string;
};

/**
 * Yayınlanan `arena-live.json`'dan yalnızca WS dinleme durumunu okur.
 * Veritabanına yazmaz; panel senkronun ilk turunu beklemeden durumu gösterir.
 */
export async function readRadarWatch(url = radarSnapshotUrl()): Promise<RadarWatchSnapshot> {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "ArenaPanel/radar-watch" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as RadarPayload;
    if (payload.schema !== 1) throw new Error("Radar verisi biçimi tanınmadı");
    return {
      ok: true,
      watch: readWatch(payload.watch),
      warnings: readWarnings(payload.warnings),
      generatedAt: typeof payload.generatedAt === "string" ? payload.generatedAt : null,
      stale: payload.stale === true,
    };
  } catch (error) {
    return {
      ok: false,
      watch: null,
      warnings: [],
      generatedAt: null,
      stale: false,
      error: (error as Error).message,
    };
  }
}

const handle = (value: unknown) => String(value ?? "").replace(/^@+/, "").trim().toLowerCase();

export async function syncRadar(url = radarSnapshotUrl()): Promise<RadarSyncResult> {
  const syncedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "ArenaPanel/radar-sync" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as RadarPayload;
    if (payload.schema !== 1 || !Array.isArray(payload.streams)) {
      throw new Error("Radar verisi biçimi tanınmadı");
    }

    // Bütün anlık görüntü bayatsa hiçbir oda "şu an canlı" sayılmamalı.
    const snapshotStale = payload.stale === true;
    const streams = payload.streams.slice(0, MAX_STREAMS);
    let rooms = 0;
    let live = 0;
    for (const stream of streams) {
      const username = handle(stream.username);
      if (!username) continue;
      const isLive = !snapshotStale && stream.stale !== true;
      const row = await upsertLiveRoom({
        username,
        roomId: String(stream.roomId ?? ""),
        nickname: String(stream.nickname ?? "") || username,
        title: String(stream.title ?? ""),
        avatar: String(stream.avatar ?? ""),
        region: String(stream.region ?? ""),
        regionBasis: stream.region ? "room" : "unknown",
        viewers: Number(stream.viewers ?? 0),
        liveNow: isLive,
        verified: isLive,
        monitoring: false,
        source: SOURCE,
      });
      if (!row) continue;
      rooms += 1;
      if (isLive) live += 1;
    }

    let chests = 0;
    const chestRows = (Array.isArray(payload.chests) ? payload.chests : []).slice(0, MAX_CHESTS);
    for (const chest of chestRows) {
      const username = handle(chest.username);
      const envelopeId = String(chest.envelopeId ?? "");
      const opensMs = Date.parse(String(chest.opensAt ?? ""));
      // Geçmiş sandıklar panel listesine girmesin; zarf doğrulaması bunları reddeder.
      if (!username || !envelopeId || !Number.isFinite(opensMs) || opensMs < Date.now() - 60_000) continue;
      const row = await recordChest(
        {
          envelopeId,
          roomId: String(chest.roomId ?? ""),
          diamondCount: Number(chest.coins ?? 0),
          peopleCount: Number(chest.slots ?? 0),
          unpackAt: Math.floor(opensMs / 1000),
          skinId: Number(chest.skinId ?? 1),
          businessType: Number(chest.businessType ?? 1),
        },
        {
          username,
          nickname: String(chest.nickname ?? "") || username,
          title: String(chest.title ?? ""),
          roomId: String(chest.roomId ?? ""),
          viewers: Number(chest.viewers ?? 0),
        },
        "radar",
      );
      if (!row) continue;
      chests += 1;
      await bumpRoomChest(row.username, row.coins, row.slots, deriveChest(row).ratio);
    }

    // Bayatlama geçişinde bir kez uyar: GitHub Actions panel ayarlarına erişemediği
    // için Telegram/Discord bildirimi panel tarafında tetiklenir.
    if (snapshotStale && state.__arenaRadarStale !== true) {
      state.__arenaRadarStale = true;
      void sendNotification(
        "⚠️ Radar verisi bayatladı: son doğrulanmış yayınlar gösteriliyor. GitHub Actions koşusunu kontrol et.",
        "radar-stale",
      ).catch(() => null);
    }
    if (!snapshotStale) state.__arenaRadarStale = false;

    state.__arenaRadarLast = {
      ok: true,
      fetched: streams.length,
      rooms,
      live,
      chests,
      stale: snapshotStale,
      syncedAt,
      watch: readWatch(payload.watch),
      warnings: readWarnings(payload.warnings),
    };
    return state.__arenaRadarLast;
  } catch (error) {
    state.__arenaRadarLast = {
      ok: false,
      fetched: 0,
      rooms: 0,
      live: 0,
      chests: 0,
      stale: false,
      syncedAt,
      error: (error as Error).message,
      watch: null,
      warnings: [],
    };
    return state.__arenaRadarLast;
  }
}

/** Panel açıkken on dakikada bir radar anlık görüntüsünü içeri aktarır. */
export function startRadarSyncLoop(intervalMs = INTERVAL_MS) {
  if (state.__arenaRadarSyncTimer) return;
  state.__arenaRadarSyncTimer = setInterval(() => void syncRadar().catch(() => null), intervalMs);
  void syncRadar().catch(() => null);
}
