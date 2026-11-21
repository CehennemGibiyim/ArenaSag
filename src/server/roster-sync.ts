import { db } from "@/db";
import { liveRooms } from "@/db/schema";
import { upsertLiveRoom } from "@/server/rooms";

/**
 * Üye defteri (roster) — GitHub Radar'ın veri dalında günlük olarak büyüyen
 * doğrulanmış yayıncı listesini PostgreSQL'e aktarır.
 *
 * Yalnızca panelde henüz olmayan yayıncılar eklenir; mevcut satırların izleyici,
 * elmas ve sandık verileri ezilmez. Böylece her gün yeni yayıncı birikir.
 */

const REPO = process.env.ARENA_GITHUB_REPO || "CehennemGibiyim/ArenaSag";
const DATA_BRANCH = process.env.ARENA_DATA_BRANCH || "data";
const SOURCE = "github-roster";
const LIVE_WINDOW_MS = 30 * 60_000;
const SYNC_LIMIT = 2000;
const NEW_PER_RUN = 400;
const INTERVAL_MS = 30 * 60_000;

type RosterEntry = {
  username?: string;
  nickname?: string;
  avatar?: string;
  region?: string;
  roomId?: string;
  firstSeen?: string;
  lastSeen?: string;
  lastLiveAt?: string;
  liveCount?: number;
};

type RosterPayload = {
  schema?: number;
  total?: number;
  today?: { date?: string; added?: number };
  days?: Array<{ date?: string; added?: number; total?: number }>;
  streamers?: RosterEntry[];
};

export type RosterSyncResult = {
  ok: boolean;
  fetched: number;
  added: number;
  skipped: number;
  live: number;
  total: number;
  today?: { date?: string; added?: number };
  days?: Array<{ date?: string; added?: number; total?: number }>;
  syncedAt: string;
  error?: string;
};

const state = globalThis as typeof globalThis & {
  __arenaRosterTimer?: ReturnType<typeof setInterval>;
  __arenaRosterLast?: RosterSyncResult | null;
};

export function rosterUrl() {
  return `https://raw.githubusercontent.com/${REPO}/${DATA_BRANCH}/web/data/roster.json`;
}

export function lastRosterSync(): RosterSyncResult | null {
  return state.__arenaRosterLast ?? null;
}

export async function syncRoster(url = rosterUrl()): Promise<RosterSyncResult> {
  const syncedAt = new Date().toISOString();
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json", "User-Agent": "ArenaPanel/roster-sync" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = (await response.json()) as RosterPayload;
    if (payload.schema !== 1 || !Array.isArray(payload.streamers)) {
      throw new Error("Üye defteri biçimi tanınmadı");
    }

    const entries = payload.streamers.slice(0, SYNC_LIMIT);
    const existing = new Set(
      (await db.select({ username: liveRooms.username }).from(liveRooms)).map((row) => row.username),
    );

    let added = 0;
    let skipped = 0;
    let live = 0;
    for (const entry of entries) {
      const username = String(entry.username ?? "").replace(/^@+/, "").trim().toLowerCase();
      if (!username) continue;
      const lastLiveAt = Date.parse(entry.lastLiveAt ?? "");
      const isLive = Number.isFinite(lastLiveAt) && Date.now() - lastLiveAt < LIVE_WINDOW_MS;
      if (isLive) live += 1;
      if (existing.has(username) || added >= NEW_PER_RUN) {
        skipped += 1;
        continue;
      }
      const row = await upsertLiveRoom({
        username,
        roomId: entry.roomId ?? "",
        nickname: entry.nickname ?? username,
        avatar: entry.avatar ?? "",
        region: entry.region ?? "",
        regionBasis: entry.region ? "room" : "unknown",
        viewers: 0,
        liveNow: isLive,
        verified: isLive,
        monitoring: false,
        source: SOURCE,
      });
      if (!row) {
        skipped += 1;
        continue;
      }
      existing.add(username);
      added += 1;
    }

    state.__arenaRosterLast = {
      ok: true,
      fetched: entries.length,
      added,
      skipped,
      live,
      total: Number(payload.total ?? payload.streamers.length),
      today: payload.today,
      days: Array.isArray(payload.days) ? payload.days.slice(0, 14) : [],
      syncedAt,
    };
    return state.__arenaRosterLast;
  } catch (error) {
    state.__arenaRosterLast = {
      ok: false,
      fetched: 0,
      added: 0,
      skipped: 0,
      live: 0,
      total: 0,
      syncedAt,
      error: (error as Error).message,
    };
    return state.__arenaRosterLast;
  }
}

/** Panel açıkken yarım saatte bir üye defterini içeri aktarır. */
export function startRosterLoop(intervalMs = INTERVAL_MS) {
  if (state.__arenaRosterTimer) return;
  state.__arenaRosterTimer = setInterval(() => void syncRoster().catch(() => null), intervalMs);
  void syncRoster().catch(() => null);
}
