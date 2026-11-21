import { readGeneratedAt, readWarnings, readWatch, type RadarWatchSnapshot } from "@/lib/radar-watch";
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
// Panel sekmeleri arasında tek upstream isteği: yayın kadansı 10 dk; 60 sn'lik
// süreç içi önbellek tazeliği bozmadan GitHub'a giden isteği seyreltir.
const WATCH_CACHE_MS = 60_000;

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
  stale?: boolean;
  generatedAt?: unknown;
  streams?: RadarStream[];
  chests?: RadarChest[];
  watch?: unknown;
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
};

const state = globalThis as typeof globalThis & {
  __arenaRadarSyncTimer?: ReturnType<typeof setTimeout | typeof setInterval>;
  __arenaRadarStale?: boolean;
  __arenaRadarWatch?: { url: string; at: number; snapshot: RadarWatchSnapshot };
  __arenaRadarWatchPending?: { url: string; promise: Promise<RadarWatchSnapshot> };
};

export function radarSnapshotUrl() {
  return `https://raw.githubusercontent.com/${REPO}/${DATA_BRANCH}/web/data/arena-live.json`;
}

type RadarFetchOptions = {
  userAgent: string;
  timeout?: number;
  /** Sync akışı stream listesini şart koşar; watch için yalnızca zarf alanları yeter. */
  requireStreams?: boolean;
};

/** Tek yerde ağ isteği + şema kontrolü: sync ve watch aynı ayrıştırmayı kullanır. */
async function fetchRadarPayload(
  url: string,
  { userAgent, timeout = 10_000, requireStreams = false }: RadarFetchOptions,
): Promise<RadarPayload> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json", "User-Agent": userAgent },
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = (await response.json()) as RadarPayload;
  if (payload?.schema !== 1 || (requireStreams && !Array.isArray(payload.streams))) {
    throw new Error("Radar verisi biçimi tanınmadı");
  }
  return payload;
}

async function loadRadarWatch(url: string): Promise<RadarWatchSnapshot> {
  try {
    const payload = await fetchRadarPayload(url, { userAgent: "ArenaPanel/radar-watch" });
    return {
      watch: readWatch(payload.watch),
      warnings: readWarnings(payload.warnings),
      generatedAt: readGeneratedAt(payload.generatedAt),
    };
  } catch (error) {
    return { watch: null, warnings: [], generatedAt: null, error: (error as Error).message };
  }
}

/**
 * Yayınlanan `arena-live.json`'dan yalnızca WS dinleme durumunu okur.
 * Veritabanına yazmaz; panel senkronun ilk turunu beklemeden durumu gösterir.
 *
 * Başarılı yanıt 60 saniye süreç içi önbellekte tutulur ve eşzamanlı sekmeler
 * aynı isteği paylaşır; her sekme GitHub'a ayrı istek atmaz. Hata önbelleğe
 * alınmaz ki GitHub toparlanınca panel hemen yeni durumu görsün.
 */
export async function readRadarWatch(url = radarSnapshotUrl()): Promise<RadarWatchSnapshot> {
  const cached = state.__arenaRadarWatch;
  if (cached && cached.url === url && Date.now() - cached.at < WATCH_CACHE_MS) return cached.snapshot;
  if (state.__arenaRadarWatchPending?.url === url) return state.__arenaRadarWatchPending.promise;
  const promise = loadRadarWatch(url)
    .then((snapshot) => {
      if (!snapshot.error) state.__arenaRadarWatch = { url, at: Date.now(), snapshot };
      return snapshot;
    })
    .finally(() => {
      if (state.__arenaRadarWatchPending?.promise === promise) state.__arenaRadarWatchPending = undefined;
    });
  state.__arenaRadarWatchPending = { url, promise };
  return promise;
}

const handle = (value: unknown) => String(value ?? "").replace(/^@+/, "").trim().toLowerCase();

export async function syncRadar(url = radarSnapshotUrl()): Promise<RadarSyncResult> {
  const syncedAt = new Date().toISOString();
  try {
    const payload = await fetchRadarPayload(url, {
      userAgent: "ArenaPanel/radar-sync",
      timeout: 15_000,
      requireStreams: true,
    });

    // Bütün anlık görüntü bayatsa hiçbir oda "şu an canlı" sayılmamalı.
    const snapshotStale = payload.stale === true;
    const streams = (payload.streams ?? []).slice(0, MAX_STREAMS);
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

    return {
      ok: true,
      fetched: streams.length,
      rooms,
      live,
      chests,
      stale: snapshotStale,
      syncedAt,
    };
  } catch (error) {
    return {
      ok: false,
      fetched: 0,
      rooms: 0,
      live: 0,
      chests: 0,
      stale: false,
      syncedAt,
      error: (error as Error).message,
    };
  }
}

/** Panel açıkken on dakikada bir radar anlık görüntüsünü içeri aktarır. */
export function startRadarSyncLoop(intervalMs = INTERVAL_MS) {
  if (state.__arenaRadarSyncTimer) return;
  state.__arenaRadarSyncTimer = setInterval(() => void syncRadar().catch(() => null), intervalMs);
  void syncRadar().catch(() => null);
}
