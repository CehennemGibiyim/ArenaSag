import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { targetStats } from "@/db/schema";

export type TargetObservation = { username: string; state: "live" | "offline" | "unknown" };

/** Below this many resolved checks in an hour, ranking falls back to the target score. */
export const MIN_HOUR_SAMPLE = 3;
/** Consecutive offline results before a target is rested. */
export const COOLING_STREAK = 3;
/** How long a rested target stays out before one revival probe. */
export const COOLING_HOURS = 6;

/** Hour 0-23 in the panel's configured timezone, with a UTC fallback for invalid zones. */
export function hourInZone(timeZone: string, at = new Date()) {
  try {
    const text = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone }).format(at);
    const hour = Number(text);
    return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : at.getUTCHours();
  } catch {
    return at.getUTCHours();
  }
}

/**
 * Persists the only feedback scheduling needs: resolved live/check counts per hour for ranking, and
 * the current offline streak for resting unproductive handles. Unknown outcomes are not evidence.
 */
export async function recordTargetObservations(rows: TargetObservation[], hour: number) {
  const unique = [...new Map(rows.map(row => [row.username, row])).values()].filter(row => row.username);
  if (!unique.length) return;
  const existing = await db
    .select()
    .from(targetStats)
    .where(inArray(targetStats.username, unique.map(row => row.username)));
  const byName = new Map(existing.map(row => [row.username, row]));
  const values = unique.map(row => {
    const prev = byName.get(row.username);
    const liveHours = Array.from({ length: 24 }, (_, index) => prev?.liveHours?.[index] ?? 0);
    const checkHours = Array.from({ length: 24 }, (_, index) => prev?.checkHours?.[index] ?? 0);
    if (row.state === "live") liveHours[hour] = (liveHours[hour] ?? 0) + 1;
    if (row.state !== "unknown") checkHours[hour] = (checkHours[hour] ?? 0) + 1;
    const offlineStreak =
      row.state === "live" ? 0 : row.state === "offline" ? (prev?.offlineStreak ?? 0) + 1 : (prev?.offlineStreak ?? 0);
    return { username: row.username, liveHours, checkHours, offlineStreak };
  });
  await db
    .insert(targetStats)
    .values(values)
    .onConflictDoUpdate({
      target: targetStats.username,
      set: {
        liveHours: sql`excluded.live_hours`,
        checkHours: sql`excluded.check_hours`,
        offlineStreak: sql`excluded.offline_streak`,
      },
    });
}
