import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, targets } from "@/db/schema";
import { audienceNote, type AudiencePick } from "@/lib/audience-signals";

/**
 * Writes audience-derived candidates into the existing watch pool (`targets`). They are only candidates:
 * the regular scan verifies them as live rooms before they can appear in the radar or be monitored.
 * Existing rows keep their own notes and display name; only the score is raised.
 */
export async function saveAudienceCandidates(host: string, picks: AudiencePick[]) {
  if (!picks.length) return 0;
  const safeHost = host.replace(/^@+/, "").slice(0, 24);
  const added = await db.transaction(async (tx) => {
    let fresh = 0;
    for (const pick of picks) {
      // Serialize the same handle seen in two rooms at once so the pool never gets duplicate rows.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`arena:audience:${pick.username}`}))`);
      const [existing] = await tx
        .select({ id: targets.id })
        .from(targets)
        .where(eq(targets.username, pick.username))
        .limit(1);
      if (existing) {
        await tx
          .update(targets)
          .set({ score: sql`greatest(${targets.score}, ${pick.score})` })
          .where(eq(targets.id, existing.id));
        continue;
      }
      await tx.insert(targets).values({
        username: pick.username,
        displayName: pick.nickname || pick.username,
        score: pick.score,
        status: "new",
        notes: `${audienceNote(pick)}${safeHost ? ` · @${safeHost} odası` : ""}`,
      });
      fresh += 1;
    }
    return fresh;
  });
  if (added > 0) {
    await db
      .insert(activityLog)
      .values({
        kind: "discovery",
        message: `İzleyici sinyali: ${added} yeni yayıncı adayı izleme havuzuna eklendi (@${safeHost}).`,
        meta: { host: safeHost, added },
      })
      .catch(() => null);
  }
  return added;
}
