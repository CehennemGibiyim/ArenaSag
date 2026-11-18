import { and, asc, desc, eq, gt, ilike, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { discoveryCache, listenerJobs, liveRooms, providerGates, radarScans } from "@/db/schema";
import { freshRoom } from "@/server/listener-queue";
import { getSettings } from "@/server/settings";
import { localCapacity } from "@/server/listener-policy";
import { eulerFeedEnabled, signingKey } from "@/server/free-discovery";
import { countryCode } from "@/lib/discovery-model";

// Neither a reserved socket slot nor a stale lease is a listening connection.
export const effectiveJob = sql<string>`case when ${listenerJobs.status} in ('connecting','listening') and coalesce(${listenerJobs.leaseUntil},now()) <= now() then 'queued' when ${listenerJobs.status}='listening' and ${listenerJobs.connectedAt} is null then 'connecting' else coalesce(${listenerJobs.status},'verified') end`;
const region = sql<string>`case when ${liveRooms.regionBasis} <> 'unknown' then ${liveRooms.region} else '' end`;
const join = and(eq(liveRooms.roomId,listenerJobs.roomId),eq(liveRooms.username,listenerJobs.username));
export const verifiedFields = { id: liveRooms.id, username: liveRooms.username, nickname: liveRooms.nickname, title: liveRooms.title, roomId: liveRooms.roomId,
  viewers: liveRooms.viewers, source: liveRooms.source, region, regionBasis: liveRooms.regionBasis, lastSeenAt: liveRooms.verifiedAt,
  jobStatus: effectiveJob, nextAttemptAt: listenerJobs.nextAttemptAt, connectedAt: listenerJobs.connectedAt };
export async function networkSnapshot(params: URLSearchParams) {
  const settings = await getSettings();
  const filter = params.get("region") || "", state = params.get("state") || "", q = (params.get("q") ?? "").replace(/^@/,"").slice(0,64);
  const take = 12;
  const page = Math.max(1, Math.min(10_000, parseInt(params.get("page") || "1",10) || 1));
  const where = and(freshRoom, filter ? eq(region, filter === "unknown" ? "" : countryCode(filter)) : undefined,
    state ? eq(effectiveJob,state) : undefined, q ? ilike(liveRooms.username,`%${q.replace(/[\\_%]/g,"\\$&")}%`) : undefined);
  return db.transaction(async tx => {
    const countryRows = await tx.select({ code: region, n: sql<number>`count(*)::int` }).from(liveRooms).where(freshRoom).groupBy(region).orderBy(sql`count(*) desc`);
    const states = await tx.select({ state: effectiveJob, n: sql<number>`count(*)::int` }).from(liveRooms).leftJoin(listenerJobs,join).where(freshRoom).groupBy(effectiveJob);
    const [total] = await tx.select({ n: sql<number>`count(*)::int` }).from(liveRooms).leftJoin(listenerJobs,join).where(where);
    const pages = Math.max(1, Math.ceil(total.n / take)), actualPage = Math.min(page,pages);
    const rooms = await tx.select(verifiedFields).from(liveRooms).leftJoin(listenerJobs,join).where(where)
      .orderBy(desc(liveRooms.viewers),asc(liveRooms.id)).limit(take).offset((actualPage-1)*take);
    const [last] = await tx.select({ id: radarScans.id, finishedAt: radarScans.finishedAt, report: radarScans.report }).from(radarScans).where(and(isNotNull(radarScans.report),isNotNull(radarScans.finishedAt))).orderBy(desc(radarScans.id)).limit(1);
    const [gate] = await tx.select({ nextAt: providerGates.nextAt, reason: providerGates.reason }).from(providerGates).where(and(eq(providerGates.provider,"listener"),gt(providerGates.nextAt,new Date())));
    const [s] = await tx.select({ nextAt: providerGates.nextAt }).from(providerGates).where(and(eq(providerGates.provider,"discovery-run"),gt(providerGates.nextAt,new Date()),sql`${providerGates.reason} like 'scan:%'`));
    const [registry] = await tx.select({ codes: discoveryCache.codes }).from(discoveryCache).where(eq(discoveryCache.key,"tikwm:registry"));
    const [quota] = await tx.select({ state: discoveryCache.state, detail: discoveryCache.detail, sample: discoveryCache.quota, nextAt: discoveryCache.nextAt }).from(discoveryCache)
      .where(eq(discoveryCache.key, `signer:quota:${signingKey() ? "keyed" : "anon"}`));
    return { rooms, last: last ?? null, states: Object.fromEntries(states.map(s=>[s.state,s.n])) as Record<string, number>, countries: countryRows,
      total: countryRows.reduce((n,c)=>n+c.n,0), filtered: total.n, pages, page: actualPage, supported: registry?.codes ?? [],
      listenerLimit: localCapacity(settings), listenToAll: settings.listenToAll, gate: gate ?? null, autoScan: settings.autoScan, running: Boolean(s),
      quota: quota ?? null, eulerAvailable: eulerFeedEnabled(), exhaustive: false, at: new Date().toISOString() };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
