import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { liveRooms, settings } from "@/db/schema";
import {
  LIVE_WINDOW_MS,
  orderRoster,
  pageRoster,
  rosterHandle,
  type RosterMember,
} from "@/lib/roster-page";

/**
 * Üye defteri (roster) — GitHub Radar'ın veri dalında günlük olarak büyüyen
 * doğrulanmış yayıncı listesini PostgreSQL'e aktarır.
 *
 * Defter `lastSeen`'e göre azalan sıralı yayınlandığı için sabit bir "ilk N
 * kayıt" dilimi eskiden eski üyeleri kalıcı olarak dışarıda bırakıyordu. Artık
 * defter `firstSeen` artan sırayla sayfalanır ve imleç `settings` içinde tutulur;
 * her tur bir sonraki 400 kişi tek bir toplu ekleme ile aktarılır.
 *
 * Yalnızca panelde henüz olmayan yayıncılar eklenir; mevcut satırların izleyici,
 * elmas ve sandık verileri ezilmez.
 */

const REPO = process.env.ARENA_GITHUB_REPO || "CehennemGibiyim/ArenaSag";
const DATA_BRANCH = process.env.ARENA_DATA_BRANCH || "data";
const SOURCE = "github-roster";
const CURSOR_KEY = "rosterSyncCursor";
const PAGE_SIZE = 400;
const INTERVAL_MS = 30 * 60_000;

type RosterPayload = {
  schema?: number;
  total?: number;
  today?: { date?: string; added?: number };
  days?: Array<{ date?: string; added?: number; total?: number }>;
  streamers?: RosterMember[];
};

export type RosterSyncResult = {
  ok: boolean;
  fetched: number;
  added: number;
  skipped: number;
  live: number;
  total: number;
  cursor: number;
  wrapped: boolean;
  unchanged?: boolean;
  today?: { date?: string; added?: number };
  days?: Array<{ date?: string; added?: number; total?: number }>;
  syncedAt: string;
  error?: string;
};

const state = globalThis as typeof globalThis & {
  __arenaRosterTimer?: ReturnType<typeof setInterval>;
  __arenaRosterLast?: RosterSyncResult | null;
  __arenaRosterEtag?: string;
};

export function rosterUrl() {
  return `https://raw.githubusercontent.com/${REPO}/${DATA_BRANCH}/web/data/roster.json`;
}

export function lastRosterSync(): RosterSyncResult | null {
  return state.__arenaRosterLast ?? null;
}

/** İmleci `settings.data` içinde tutar; şeması değişmeyen tek satırlık kayıt. */
async function readCursor(): Promise<number> {
  try {
    const [row] = await db.select({ data: settings.data }).from(settings).where(eq(settings.id, 1)).limit(1);
    const value = Number((row?.data as Record<string, unknown> | undefined)?.[CURSOR_KEY]);
    return Number.isInteger(value) && value >= 0 ? value : 0;
  } catch {
    return 0;
  }
}

async function saveCursor(cursor: number): Promise<void> {
  const updated = await db
    .update(settings)
    .set({
      data: sql`jsonb_set(coalesce(${settings.data}, '{}'::jsonb), '{rosterSyncCursor}', to_jsonb(${cursor}::int))`,
      updatedAt: new Date(),
    })
    .where(eq(settings.id, 1))
    .returning({ id: settings.id });
  if (updated.length) return;
  await db
    .insert(settings)
    .values({ id: 1, data: { [CURSOR_KEY]: cursor } })
    .onConflictDoNothing();
}

export async function syncRoster(url = rosterUrl()): Promise<RosterSyncResult> {
  const syncedAt = new Date().toISOString();
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "ArenaPanel/roster-sync",
    };
    // Dosya değişmediyse ham gövdeyi indirmeden 304 al.
    if (state.__arenaRosterEtag) headers["If-None-Match"] = state.__arenaRosterEtag;
    const response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 304 && state.__arenaRosterLast) {
      return { ...state.__arenaRosterLast, unchanged: true, syncedAt };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.__arenaRosterEtag = response.headers.get("etag") ?? "";
    const payload = (await response.json()) as RosterPayload;
    if (payload.schema !== 1 || !Array.isArray(payload.streamers)) {
      throw new Error("Üye defteri biçimi tanınmadı");
    }

    const members = orderRoster(payload.streamers);
    const cursor = await readCursor();
    const page = pageRoster(members, cursor, PAGE_SIZE);
    const now = Date.now();
    const rows = page.items
      .map((entry) => {
        const username = rosterHandle(entry.username);
        if (!username) return null;
        const lastLiveAt = Date.parse(String(entry.lastLiveAt ?? ""));
        const isLive = Number.isFinite(lastLiveAt) && now - lastLiveAt < LIVE_WINDOW_MS;
        return {
          username,
          roomId: String(entry.roomId ?? ""),
          nickname: String(entry.nickname ?? "") || username,
          avatar: String(entry.avatar ?? ""),
          region: String(entry.region ?? ""),
          regionBasis: entry.region ? ("room" as const) : ("unknown" as const),
          viewers: 0,
          liveNow: isLive,
          verified: isLive,
          monitoring: false,
          source: SOURCE,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);

    // Tek toplu ekleme: 400 ayrı gidiş-dönüş yerine bir sorgu.
    const inserted = rows.length
      ? await db
          .insert(liveRooms)
          .values(rows)
          .onConflictDoNothing({ target: liveRooms.username })
          .returning({ username: liveRooms.username })
      : [];
    await saveCursor(page.nextCursor);

    const result: RosterSyncResult = {
      ok: true,
      fetched: rows.length,
      added: inserted.length,
      skipped: rows.length - inserted.length,
      live: rows.filter((row) => row.liveNow).length,
      total: page.total,
      cursor: page.nextCursor,
      wrapped: page.wrapped,
      today: payload.today,
      days: Array.isArray(payload.days) ? payload.days.slice(0, 14) : [],
      syncedAt,
    };
    state.__arenaRosterLast = result;
    return result;
  } catch (error) {
    state.__arenaRosterLast = {
      ok: false,
      fetched: 0,
      added: 0,
      skipped: 0,
      live: 0,
      total: 0,
      cursor: 0,
      wrapped: false,
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
