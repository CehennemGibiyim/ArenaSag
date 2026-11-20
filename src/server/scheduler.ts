import { and, eq, gte, gt, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { targets, targetStats } from "@/db/schema";
import { COOLING_HOURS, COOLING_STREAK, MIN_HOUR_SAMPLE } from "@/server/target-feedback";

const HOUR_MS = 60 * 60_000;

/** Targets rested after repeated offline checks; old enough for one revival probe are not rested. */
export async function coolingUsernames(limit = 500) {
  const rows = await db
    .select({ username: targets.username })
    .from(targets)
    .innerJoin(targetStats, eq(targetStats.username, targets.username))
    .where(
      and(
        gte(targetStats.offlineStreak, COOLING_STREAK),
        gt(targets.lastCheckedAt, new Date(Date.now() - COOLING_HOURS * HOUR_MS)),
      ),
    )
    .limit(limit);
  return new Set(rows.map(row => row.username));
}

/**
 * Hourly live/check ratio ranking. Raw hit counts are deliberately ignored: more checks must not
 * lift a target on their own. A target with too few resolved checks in this hour falls back to its
 * score, and a resting target is excluded until its revival window opens.
 */
export function watchCandidates(hour: number, limit = 48) {
  const cutoff = new Date(Date.now() - COOLING_HOURS * HOUR_MS);
  return db
    .select({ username: targets.username, displayName: targets.displayName })
    .from(targets)
    .leftJoin(targetStats, eq(targetStats.username, targets.username))
    .where(
      or(
        lt(sql`coalesce(${targetStats.offlineStreak}, 0)`, COOLING_STREAK),
        isNull(targets.lastCheckedAt),
        lt(targets.lastCheckedAt, cutoff),
      ),
    )
    .orderBy(
      sql`case when coalesce(${targetStats.checkHours}[${hour + 1}], 0) >= ${MIN_HOUR_SAMPLE}
        then coalesce(${targetStats.liveHours}[${hour + 1}], 0)::float / ${targetStats.checkHours}[${hour + 1}]
        else ${targets.score} / 100.0 end desc`,
      sql`${targets.lastCheckedAt} asc nulls first`,
    )
    .limit(limit);
}
