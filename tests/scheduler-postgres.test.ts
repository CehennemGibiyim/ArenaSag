import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { Client, type Pool } from "pg";

/**
 * Real PostgreSQL smoke test. CI supplies a postgres:16 service and DATABASE_URL. Locally:
 *
 *   docker run --rm -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=arena_smoke \
 *     -p 5432:5432 postgres:16-alpine
 *   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/arena_smoke npm run test:postgres
 *
 * The public schema is dropped before the test, so DATABASE_URL must point at a disposable database.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOUR_MS = 60 * 60_000;

/** Generate the schema from source so the test cannot drift from the Drizzle definitions. */
function generatedSchemaSql() {
  const work = mkdtempSync(path.join(tmpdir(), "arena-schema-"));
  try {
    const out = path.join(work, "out");
    const config = path.join(work, "drizzle.config.json");
    writeFileSync(
      config,
      JSON.stringify({ dialect: "postgresql", schema: path.join(root, "src/db/schema.ts"), out }),
    );
    try {
      execFileSync(
        process.execPath,
        [path.join(root, "node_modules/drizzle-kit/bin.cjs"), "generate", "--config", config],
        { cwd: root, stdio: "pipe" },
      );
    } catch (error) {
      const stderr = (error as { stderr?: Buffer | string }).stderr;
      throw new Error(`drizzle-kit generate failed: ${stderr?.toString() ?? String(error)}`);
    }
    const sql = readdirSync(out)
      .filter(name => name.endsWith(".sql"))
      .sort()
      .map(name => readFileSync(path.join(out, name), "utf8"))
      .join("\n");
    assert.ok(sql.includes("target_stats"), "Generated schema is missing target_stats.");
    return sql;
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function disposableDatabaseUrl() {
  const url = process.env.DATABASE_URL;
  assert.ok(
    url,
    "DATABASE_URL must point to a disposable arena_smoke database. Start postgres:16 (see the file header) and pass its URL.",
  );
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  assert.match(
    name,
    /^arena_smoke(?:_[a-z0-9]+)?$/i,
    "DATABASE_URL must point to a disposable arena_smoke database.",
  );
  return url;
}

async function applySchema(url: string) {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
    await client.query(generatedSchemaSql());
  } finally {
    await client.end();
  }
}

function hours(entries: Record<number, number> = {}) {
  return Array.from({ length: 24 }, (_, index) => entries[index] ?? 0);
}

test(
  "real PostgreSQL: hourly array index, cooling transition and listener order",
  { timeout: 180_000 },
  async t => {
    const databaseUrl = disposableDatabaseUrl();
    let pool: Pool | undefined;

    t.after(async () => {
      await pool?.end().catch(() => undefined);
      delete (globalThis as typeof globalThis & { __arenaNextJsPostgresqlPool?: Pool })
        .__arenaNextJsPostgresqlPool;
    });

    await applySchema(databaseUrl);

    const { db, pool: appPool } = await import("../src/db");
    pool = appPool;
    const { targets, targetStats, listenerJobs, liveRooms, providerGates, chests } = await import(
      "../src/db/schema"
    );
    const { recordTargetObservations } = await import("../src/server/target-feedback");
    const { coolingUsernames, watchCandidates } = await import("../src/server/scheduler");
    const { claimRoom } = await import("../src/server/listener-queue");

    // The generated schema is the source of truth. Rested fields must be gone and the new feedback
    // columns present, otherwise the queries below would still run against an old database.
    const columns = await appPool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name
         from information_schema.columns
        where table_schema = 'public'
          and table_name in ('target_stats', 'listener_jobs', 'targets')`,
    );
    const byTable = new Map<string, string[]>();
    for (const row of columns.rows) {
      byTable.set(row.table_name, [...(byTable.get(row.table_name) ?? []), row.column_name]);
    }
    assert.deepEqual(
      byTable.get("target_stats")?.sort(),
      ["check_hours", "live_hours", "offline_streak", "username"],
      "target_stats must contain only the four scheduling fields.",
    );
    const jobColumns = byTable.get("listener_jobs") ?? [];
    assert.ok(jobColumns.includes("listened_seconds"), "listener_jobs.listened_seconds is missing.");
    assert.ok(!jobColumns.includes("priority"), "listener_jobs.priority must stay removed.");
    assert.ok(!jobColumns.includes("explore_pending"), "listener_jobs.explore_pending must stay removed.");
    assert.ok(!(byTable.get("targets") ?? []).includes("source"), "targets.source must stay removed.");

    // Hour 21 and 22 use different 1-based array positions. Reversing the leader when the requested
    // hour changes proves the +1 index; the two-check target proves the minimum sample fallback.
    await db.insert(targets).values([
      { username: "smoke_hour_21", displayName: "Hour 21", score: 0 },
      { username: "smoke_hour_22", displayName: "Hour 22", score: 0 },
      { username: "smoke_hour_fallback", displayName: "Fallback", score: 50 },
    ]);
    await db.insert(targetStats).values([
      { username: "smoke_hour_21", liveHours: hours({ 21: 2 }), checkHours: hours({ 21: 3 }) },
      { username: "smoke_hour_22", liveHours: hours({ 22: 3 }), checkHours: hours({ 22: 3 }) },
      { username: "smoke_hour_fallback", liveHours: hours({ 21: 2 }), checkHours: hours({ 21: 2 }) },
    ]);
    const rankedAt = async (hour: number) =>
      (await watchCandidates(hour, 24))
        .map(row => row.username)
        .filter(name => name.startsWith("smoke_hour_"));
    assert.deepEqual(
      await rankedAt(21),
      ["smoke_hour_21", "smoke_hour_fallback", "smoke_hour_22"],
      "Hour 21 must rank 2/3 above the score fallback and the target with no checks at that hour.",
    );
    assert.deepEqual(
      await rankedAt(22),
      ["smoke_hour_22", "smoke_hour_fallback", "smoke_hour_21"],
      "Hour 22 must use check_hours[23] and reverse the leader.",
    );

    // Two offline results are not enough to rest a target; the third is. A live result clears the
    // streak, unknown does not count, and a resting target is eligible again after six hours.
    await db.insert(targets).values({
      username: "smoke_cool",
      displayName: "Cool",
      score: 50,
      lastCheckedAt: new Date(),
    });
    await db.insert(targetStats).values({
      username: "smoke_cool",
      liveHours: hours(),
      checkHours: hours(),
      offlineStreak: 2,
    });
    await recordTargetObservations([{ username: "smoke_cool", state: "offline" }], 21);
    let [stat] = await db.select().from(targetStats).where(eq(targetStats.username, "smoke_cool"));
    assert.equal(stat.offlineStreak, 3, "The third offline result must start the cooling streak.");
    assert.equal(stat.checkHours[21], 1);
    assert.equal(stat.liveHours[21], 0);
    assert.ok((await coolingUsernames()).has("smoke_cool"), "A streak of three must be rested.");
    assert.ok(
      !(await watchCandidates(21, 24)).some(row => row.username === "smoke_cool"),
      "A resting target must not be ranked.",
    );

    await recordTargetObservations([{ username: "smoke_cool", state: "live" }], 21);
    [stat] = await db.select().from(targetStats).where(eq(targetStats.username, "smoke_cool"));
    assert.equal(stat.offlineStreak, 0, "A live result must clear the cooling streak.");
    assert.equal(stat.checkHours[21], 2);
    assert.equal(stat.liveHours[21], 1);
    assert.ok(!(await coolingUsernames()).has("smoke_cool"));
    assert.ok(
      (await watchCandidates(21, 24)).some(row => row.username === "smoke_cool"),
      "A target with a cleared streak must be ranked again.",
    );

    await recordTargetObservations([{ username: "smoke_cool", state: "unknown" }], 21);
    [stat] = await db.select().from(targetStats).where(eq(targetStats.username, "smoke_cool"));
    assert.equal(stat.checkHours[21], 2, "Unknown outcomes must not count as resolved checks.");
    assert.equal(stat.liveHours[21], 1);
    assert.equal(stat.offlineStreak, 0);

    await db
      .update(targets)
      .set({ lastCheckedAt: new Date(Date.now() - 7 * HOUR_MS) })
      .where(eq(targets.username, "smoke_cool"));
    await db
      .update(targetStats)
      .set({ offlineStreak: 3 })
      .where(eq(targetStats.username, "smoke_cool"));
    assert.ok(!(await coolingUsernames()).has("smoke_cool"), "The six-hour window must end the rest.");
    assert.ok(
      (await watchCandidates(21, 24)).some(row => row.username === "smoke_cool"),
      "A rested target must get one revival probe after six hours.",
    );

    // Five old starts put the next claim in the reserved exploration slot; four put it in a yield
    // slot. Both use the same claimRoom SQL as production.
    const roomIds = {
      fresh: "9100000000000000001",
      yieldA: "9100000000000000002",
      yieldB: "9100000000000000003",
    };
    await db.insert(liveRooms).values([
      {
        username: "smoke_fresh",
        roomId: roomIds.fresh,
        nickname: "Fresh",
        liveNow: true,
        verifiedAt: new Date(),
        source: "smoke",
      },
      {
        username: "smoke_yield_a",
        roomId: roomIds.yieldA,
        nickname: "Yield A",
        liveNow: true,
        verifiedAt: new Date(),
        source: "smoke",
      },
      {
        username: "smoke_yield_b",
        roomId: roomIds.yieldB,
        nickname: "Yield B",
        liveNow: true,
        verifiedAt: new Date(),
        source: "smoke",
      },
    ]);
    const now = Date.now();
    await db.insert(listenerJobs).values([
      {
        roomId: roomIds.fresh,
        username: "smoke_fresh",
        status: "queued",
        nextAttemptAt: new Date(now - 2 * 60_000),
        listenedSeconds: 0,
      },
      {
        roomId: roomIds.yieldA,
        username: "smoke_yield_a",
        status: "queued",
        nextAttemptAt: new Date(now),
        listenedSeconds: 600,
      },
      {
        roomId: roomIds.yieldB,
        username: "smoke_yield_b",
        status: "queued",
        nextAttemptAt: new Date(now),
        listenedSeconds: 600,
      },
    ]);
    await db.insert(chests).values([
      ...Array.from({ length: 3 }, () => ({
        envelopeId: randomUUID(),
        roomId: roomIds.yieldA,
        username: "smoke_yield_a",
        coins: 10,
        slots: 1,
        detectedAt: new Date(),
      })),
      {
        envelopeId: randomUUID(),
        roomId: roomIds.yieldB,
        username: "smoke_yield_b",
        coins: 10,
        slots: 1,
        detectedAt: new Date(),
      },
    ]);

    const setGate = async (startsCount: number) => {
      const starts = Array.from(
        { length: startsCount },
        (_, index) => Date.now() - 2 * HOUR_MS + index * 1_000,
      );
      await db
        .insert(providerGates)
        .values({ provider: "listener", starts, nextAt: new Date(0), reason: "smoke" })
        .onConflictDoUpdate({
          target: providerGates.provider,
          set: { starts, nextAt: new Date(0), reason: "smoke" },
        });
    };
    const release = async (id: number) => {
      await db
        .update(listenerJobs)
        .set({
          status: "queued",
          owner: "",
          leaseUntil: null,
          connectedAt: null,
          nextAttemptAt: new Date(Date.now() - 60_000),
        })
        .where(eq(listenerJobs.id, id));
    };

    await setGate(5);
    const fresh = await claimRoom(1);
    assert.ok(fresh, "The exploration slot did not claim a room.");
    assert.equal(fresh.username, "smoke_fresh", "The exploration slot must pick the never-listened room.");

    await release(fresh.id);
    await setGate(4);
    // Keep the first lease active, as production does, so the next claim must skip it and compare
    // the remaining rooms by yield instead of picking the same leader again.
    const yieldA = await claimRoom(2);
    assert.ok(yieldA, "The first yield slot did not claim a room.");
    assert.equal(yieldA.username, "smoke_yield_a", "Three chests in 600s must lead the yield order.");

    await setGate(4);
    const yieldB = await claimRoom(2);
    assert.ok(yieldB, "The second yield slot did not claim a room.");
    assert.equal(yieldB.username, "smoke_yield_b", "One chest in 600s must beat the never-listened room.");
    assert.notEqual(yieldB.roomId, yieldA.roomId, "An active lease must not be stolen.");
  },
);
