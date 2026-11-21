import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Veri saklama — panel veritabanının sınırsız büyümesini engeller.
 *
 * Radar verisi git'te tutuluyor; PostgreSQL tarafında yalnızca panelin işine
 * yarayan pencere kalır. Süreler bilinçli olarak geniş: geçmiş raporlar
 * silinmez, yalnızca operasyonel gürültü temizlenir.
 */

export type RetentionResult = {
  chests: number;
  events: number;
  scanTasks: number;
  radarScans: number;
  activity: number;
  ranAt: string;
};

const DAY_MS = 24 * 60 * 60_000;

async function remove(query: ReturnType<typeof sql>): Promise<number> {
  const result = (await db.execute(query)) as unknown as { rowCount?: number | null };
  return Number(result.rowCount ?? 0);
}

export async function runRetention(): Promise<RetentionResult> {
  const chests = await remove(sql`delete from chests where coalesce(opens_at, detected_at) < now() - interval '45 days'`);
  const events = await remove(sql`delete from live_events where created_at < now() - interval '30 days'`);
  const scanTasks = await remove(sql`delete from scan_tasks where created_at < now() - interval '14 days'`);
  const radarScans = await remove(sql`delete from radar_scans where started_at < now() - interval '90 days'`);
  const activity = await remove(sql`delete from activity_log where created_at < now() - interval '30 days'`);
  return {
    chests,
    events,
    scanTasks,
    radarScans,
    activity,
    ranAt: new Date().toISOString(),
  };
}

const state = globalThis as typeof globalThis & {
  __arenaRetentionTimer?: ReturnType<typeof setInterval>;
  __arenaRetentionLast?: RetentionResult | null;
};

export function lastRetention(): RetentionResult | null {
  return state.__arenaRetentionLast ?? null;
}

/** Günde bir kez çalışır; ilk tur açılıştan 5 dakika sonra. */
export function startRetentionLoop(intervalMs = DAY_MS) {
  if (state.__arenaRetentionTimer) return;
  const run = () => void runRetention()
    .then((result) => {
      state.__arenaRetentionLast = result;
    })
    .catch(() => null);
  const first = setTimeout(run, 5 * 60_000);
  first.unref?.();
  state.__arenaRetentionTimer = setInterval(run, intervalMs);
  state.__arenaRetentionTimer.unref?.();
}
