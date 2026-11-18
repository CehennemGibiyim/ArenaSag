import { upsertLiveRoom, type RoomUpsert } from "@/server/rooms";
import { randomUUID } from "node:crypto";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { listenerJobs, liveRooms, providerGates, type ListenerJob } from "@/db/schema";
import { cleanHandle, roomKey, type QuotaSample } from "@/lib/discovery-model";
import { nextStart } from "@/server/listener-policy";

const LEASE_MS = 60_000;
export const leaseEnd = () => new Date(Date.now() + LEASE_MS);
export const LEASE_STATES = ["connecting", "listening"];
export const owned = (job: ListenerJob) => and(eq(listenerJobs.id, job.id), eq(listenerJobs.owner, job.owner), gt(listenerJobs.leaseUntil, new Date()));
export const freshRoom = sql`(${liveRooms.liveNow} and ${liveRooms.verifiedAt} > now() - interval '30 minutes')`;
export async function enqueue(input: RoomUpsert & { roomId: string; username: string; nickname: string; title: string; viewers: number }) {
  const username = cleanHandle(input.username), roomId = roomKey(input.roomId);
  if (!username || !roomId) throw new Error("Doğrulanmış oda kimliği ve yayıncı adı gerekli.");
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`arena:host:${username}`}))`);
    const [priorHost] = await tx.select({ id: listenerJobs.id }).from(listenerJobs).where(eq(listenerJobs.username,username)).limit(1);
    await tx.update(listenerJobs).set({ status: "offline", owner: "", leaseUntil: null, connectedAt: null, updatedAt: new Date() })
      .where(and(eq(listenerJobs.username, username), sql`${listenerJobs.roomId} <> ${roomId} and ${listenerJobs.status} <> 'offline'`));
    await upsertLiveRoom({ ...input, roomId, username, liveNow: true, verified: true }, tx);
    const values = { roomId, username, nickname: input.nickname, title: input.title, viewers: input.viewers };
    const [created] = await tx.insert(listenerJobs).values(values).onConflictDoNothing({ target: listenerJobs.roomId }).returning({ id: listenerJobs.id });
    if (created) return { newRoom: true, firstHost: !priorHost };
    // Reverification never bypasses backoff or steals a connecting/listening lease.
    await tx.update(listenerJobs).set({ ...values, updatedAt: new Date(),
      status: sql`case when ${listenerJobs.status} = 'offline' then 'queued' else ${listenerJobs.status} end`,
      nextAttemptAt: sql`case when ${listenerJobs.status} = 'offline' then now() else ${listenerJobs.nextAttemptAt} end` }).where(eq(listenerJobs.roomId, roomId));
    return { newRoom: false, firstHost: false };
  });
}
export async function claimRoom(capacity: number, quota?: QuotaSample | null): Promise<ListenerJob | null> {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(61720401)`);
    const now = Date.now();
    const [gate] = await tx.select().from(providerGates).where(eq(providerGates.provider, "listener"));
    if (gate && +gate.nextAt > now) return null;
    const budget = nextStart(gate?.starts ?? [], now, quota);
    if (budget.next > now) {
      const wait = { provider: "listener", reason: "Bağlantı başlatma bütçesi", nextAt: new Date(budget.next) };
      await tx.insert(providerGates).values(wait).onConflictDoUpdate({ target: providerGates.provider, set: { ...wait, nextAt: sql`greatest(${providerGates.nextAt}, excluded.next_at)` } });
      return null;
    }
    const [active] = await tx.select({ n: sql<number>`count(*)::int` }).from(listenerJobs)
      .where(and(inArray(listenerJobs.status, LEASE_STATES), gt(listenerJobs.leaseUntil, new Date(now))));
    if (active.n >= capacity) return null;
    const [candidate] = await tx.select({ id: listenerJobs.id }).from(listenerJobs)
      .innerJoin(liveRooms, and(eq(liveRooms.roomId, listenerJobs.roomId), eq(liveRooms.username, listenerJobs.username)))
      .where(and(freshRoom, sql`${listenerJobs.nextAttemptAt} <= now()`,
        sql`(${listenerJobs.status} in ('queued','retry') or (${listenerJobs.status} in ('connecting','listening') and coalesce(${listenerJobs.leaseUntil}, now()) <= now()))`))
      .orderBy(asc(listenerJobs.nextAttemptAt), asc(listenerJobs.id)).limit(1).for("update", { of: listenerJobs, skipLocked: true });
    if (!candidate) return null;
    // Space starts across replicas, without tearing down healthy sockets.
    const next = new Date(now + 20_500);
    const starts = [...budget.active, now];
    await tx.insert(providerGates).values({ provider: "listener", nextAt: next, reason: "Bağlantı başlatma aralığı", starts }).onConflictDoUpdate({ target: providerGates.provider,
      set: { nextAt: sql`greatest(${providerGates.nextAt}, excluded.next_at)`, starts, reason: sql`case when excluded.next_at >= ${providerGates.nextAt} then excluded.reason else ${providerGates.reason} end` } });
    const [leased] = await tx.update(listenerJobs).set({ status: "connecting", owner: randomUUID(), leaseUntil: leaseEnd(),
      lastAttemptAt: new Date(now), connectedAt: null, updatedAt: new Date(now) }).where(eq(listenerJobs.id, candidate.id)).returning();
    return leased;
  });
}
export async function markOffline(username: string, roomId: string) {
  // Fence to the room observed in this scan, not a newer broadcast by this host.
  if (!roomId) return;
  await db.transaction(async tx => {
    await tx.update(liveRooms).set({ liveNow: false, monitoring: false }).where(and(eq(liveRooms.username, username), eq(liveRooms.roomId, roomId)));
    await tx.update(listenerJobs).set({ status: "offline", owner: "", leaseUntil: null, connectedAt: null, updatedAt: new Date() }).where(and(eq(listenerJobs.username, username), eq(listenerJobs.roomId, roomId)));
  });
}
