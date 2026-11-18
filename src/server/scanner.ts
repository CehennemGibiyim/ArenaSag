import { and, asc, desc, eq, gt, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, chests, cohostCandidates, listenerJobs, liveRooms, providerGates, radarScans, targets } from "@/db/schema";
import { asCandidate, cleanHandle, countryCode, directoryBatch, type Candidate, type DiscoveryReport, type RegionBasis, type SourceRead } from "@/lib/discovery-model";
import { discoverAllRegions, REGIONS_ALL, summarizeRegions } from "@/server/discovery-global";
import { eulerFeedEnabled, publicDirectory, regionalSamples, tickerSample } from "@/server/free-discovery";
import { enqueueVerifiedRoom, startListenerWorker } from "@/server/listener-worker";
import { freshRoom, markOffline } from "@/server/listener-queue";
import { localCapacity } from "@/server/listener-policy";
import { verifyCandidates } from "@/server/verify-rooms";
import { getSettings } from "@/server/settings";
import { bumpRoomChest, radarOverview } from "@/server/rooms";
import { deriveChest, expireOldChests, recordChest } from "@/server/chest";

const state = globalThis as typeof globalThis & { __arenaDiscoveryLoop?: ReturnType<typeof setInterval> };
const MIN = 60_000;
export function startScannerLoop() {
  startListenerWorker();
  if (state.__arenaDiscoveryLoop) return;
  const automatic = async () => {
    const settings = await getSettings();
    if (settings.autoScan === false) return;
    const [last] = await db.select({ at: radarScans.finishedAt }).from(radarScans).where(isNotNull(radarScans.finishedAt)).orderBy(desc(radarScans.id)).limit(1);
    if (!last?.at || Date.now() >= +last.at + interval(settings.scanIntervalSeconds) * 1000) await runScan();
  };
  state.__arenaDiscoveryLoop = setInterval(() => void automatic().catch(() => null), 10_000);
  void automatic().catch(() => null);
}
export function stopScannerLoop() { clearInterval(state.__arenaDiscoveryLoop); delete state.__arenaDiscoveryLoop; }
const interval = (n: number) => Math.max(60, Math.min(3600, Math.floor(Number(n) || 120)));
export type ScanOptions = { regions?: string[]; only?: string[]; listenSecondsOverride?: number; maxRoomsOverride?: number };
const sourceRead = (id: string): SourceRead => ({ id, candidates: 0, checked: 0, verified: 0, newRooms: 0, requests: 0, cached: 0, state: "empty", detail: "" });
const message = (e: unknown) => e instanceof Error ? e.message.slice(0, 180) : "Bilinmeyen hata";

async function startRun(source: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(61720402)`);
    const [gate] = await tx.select().from(providerGates).where(eq(providerGates.provider, "discovery-run"));
    if (gate && +gate.nextAt > Date.now()) return null;
    await tx.update(radarScans).set({ finishedAt: new Date(), error: "Önceki tur kesildi; tamamlanmış tarama sayılmadı." }).where(isNull(radarScans.finishedAt));
    const [scan] = await tx.insert(radarScans).values({ source }).returning();
    const lease = { provider: "discovery-run", nextAt: new Date(Date.now() + 2 * MIN), reason: `scan:${scan.id}` };
    await tx.insert(providerGates).values(lease).onConflictDoUpdate({ target: providerGates.provider, set: lease });
    return scan;
  });
}

export async function runScan(options: ScanOptions = {}) {
  const selected = [...new Set((options.regions ?? []).map(countryCode).filter(Boolean))];
  const only = [...new Set((options.only ?? []).map(cleanHandle).filter(Boolean))];
  const settings = await getSettings();
  const enabled = eulerFeedEnabled();
  const source = only.length ? "manual" : "free-discovery";
  const scope = { regions: selected, regionCoverage: "sample", eulerAvailable: enabled };
  const scan = await startRun(source);
  const report: DiscoveryReport = { version: 1, selected, supported: 0, markets: [], sources: [], checked: 0, verified: 0,
    newRooms: 0, firstHosts: 0, repeatedRooms: 0, offline: 0, unknown: 0, deferred: 0, eulerRequests: 0, registryRequests: 0, errors: [] };
  const common = { scope, report, scanId: scan?.id ?? 0, regionSummary: null as ReturnType<typeof summarizeRegions> | null,
    checked: 0, liveFound: 0, chestsFound: 0, queued: 0, eulerRequests: 0, publicRequests: 0, source, error: "", errors: report.errors };
  if (!scan) return { ...common, source: "busy", error: "Tur sürüyor veya kısa bekleme aralığında. Yeni istek gönderilmedi." };
  const gate = and(eq(providerGates.provider, "discovery-run"), eq(providerGates.reason, `scan:${scan.id}`));
  const beat = setInterval(() => { void db.update(providerGates).set({ nextAt: new Date(Date.now() + 2 * MIN) }).where(gate).catch(() => null); }, 20_000);
  const all = new Map<string, { candidate: Candidate; group: SourceRead }>();
  const include = (rows: (Candidate | null)[], s: SourceRead, restrict = false) => {
    const list = rows.filter((c): c is Candidate => c !== null);
    s.candidates = new Set(list.map(c => c.username)).size;
    for (const c of list) {
      if (restrict && selected.length && !selected.includes(c.region)) continue;
      const old = all.get(c.username);
      if (!old) all.set(c.username, { candidate: c, group: s });
      else {
        if (!old.candidate.roomId && c.roomId) old.candidate.roomId = c.roomId;
        const rank: Record<RegionBasis,number> = { unknown:0, market:1, directory:2, sample:3, room:4 };
        if (rank[c.regionBasis] > rank[old.candidate.regionBasis]) { old.candidate.region = c.region; old.candidate.regionBasis = c.regionBasis; }
      }
    }
    report.sources.push(s);
  };
  try {
    if (!only.length) {
      const [ticker, directory, regional] = await Promise.allSettled([tickerSample(), publicDirectory(), settings.scanAllCountries || selected.length ? regionalSamples(selected) : Promise.resolve(null)]);
      const t = sourceRead("public-sample");
      if (ticker.status === "fulfilled") {
        const r = ticker.value; Object.assign(t, { state: r.state, detail: r.detail, cached: Number(r.cached), requests: r.requests });
        include(r.rows,t,true); common.publicRequests = r.requests;
      } else { t.state = "error"; t.detail = "Açık liste okunamadı."; include([],t); }
      const w = sourceRead("tikwm");
      if (regional.status === "fulfilled" && regional.value) {
        const r = regional.value;
        report.supported = r.registry.codes.length; report.registryRequests = r.registry.requests; report.markets = r.markets;
        w.requests = r.markets.reduce((n,m) => n+m.requests, 0); w.cached = r.markets.filter(m => m.cached).length;
        w.state = r.markets.find(m => m.state === "limited" || m.state === "error")?.state ?? (r.rows.length ? "ok" : r.registry.state !== "ok" ? r.registry.state : "empty");
        w.detail = r.registry.detail || (r.unsupported.length ? `Listede olmayan bölge: ${r.unsupported.join(", ")}` : "");
        include(r.rows,w);
      } else { w.state = regional.status === "rejected" ? "error" : "disabled"; w.detail = w.state === "error" ? "Bölge kaynağı okunamadı." : "Bölge örneklemesi kapalı."; include([],w); }
      const d = sourceRead("directory");
      if (directory.status === "fulfilled") {
        const src = directory.value; d.state = src.state; d.requests = src.requests; d.cached = Number(src.cached);
        d.detail = src.detail || `${src.rows.length} kayıtlı aday · ${src.codes.length} ülke etiketi. Canlılık ayrı doğrulanır.`;
        include(directoryBatch(src.rows,selected,scan.id),d);
      } else { d.state = "error"; d.detail = "Aday dizini okunamadı."; include([],d); }
      const peer = sourceRead("cohost");
      const peers = await db.select().from(cohostCandidates).where(gt(cohostCandidates.seenAt, new Date(Date.now() - 30*MIN))).orderBy(desc(cohostCandidates.seenAt)).limit(32);
      peer.state = peers.length ? "ok" : "empty";
      include(peers.map(r => asCandidate(r.username,r.nickname,r.roomId,"","unknown","cohost")),peer,true);
      if (enabled) {
        // Only invoked on explicit server-side opt-in. Never fall back to paid discovery on a free-source error.
        const supported = new Set<string>(REGIONS_ALL);
        const markets = (selected.length ? selected : report.markets.map(m => m.region)).filter(r => supported.has(r)).slice(0,4);
        const e = sourceRead("euler");
        if (markets.length) {
          const r = await discoverAllRegions(process.env.EULER_API_KEY!.trim(), { regions: markets, concurrency: 1 });
          e.requests = report.eulerRequests = r.regions.length; e.state = r.failedRegions.length ? "error" : r.rooms.length ? "ok" : "empty";
          common.regionSummary = summarizeRegions(r.regions);
          include(r.rooms.map(room => asCandidate(room.user,room.nickname,room.roomId,room.region,"market","euler")),e);
        } else { e.detail = "Desteklenen bölge seçilmedi."; include([],e); }
      }
    }
    const saved = sourceRead("saved");
    const [rooms, watched] = only.length ? [[],[]] as const : await Promise.all([
      db.select().from(liveRooms).where(or(eq(liveRooms.liveNow, true),eq(liveRooms.pinned,true),gt(liveRooms.verifiedAt,new Date(Date.now()-24*60*MIN))))
        .orderBy(sql`${liveRooms.probedAt} asc nulls first`, asc(liveRooms.id)).limit(120),
      db.select().from(targets).orderBy(sql`${targets.lastCheckedAt} asc nulls first`).limit(48)]);
    const candidates = only.length ? only.map(u => asCandidate(u,u,"","","unknown","manual")) : [
      ...rooms.map(r => asCandidate(r.username, r.nickname, r.roomId, r.regionBasis === "unknown" ? "" : r.region, r.regionBasis as RegionBasis, r.source)),
      ...watched.map(r => asCandidate(r.username, r.displayName,"","","unknown","targets"))];
    saved.state = candidates.length ? "ok" : "empty"; include(candidates,saved,!only.length);
    // Fair verification budget. Neither a huge directory nor old rooms can monopolize a scan.
    const groups = report.sources.map(source => [...all.values()].filter(v => v.group === source));
    const probes: Candidate[] = [];
    while (probes.length < 112 && groups.some(g => g.length)) {
      for (const group of groups) { if (group.length && probes.length < 112) probes.push(group.shift()!.candidate); }
    }
    report.deferred = all.size - probes.length;
    const observations = await verifyCandidates(probes);
    const seen = new Set<string>();
    for (const o of observations) {
      const seed = o.seed, group = all.get(seed.username)!.group;
      report.checked++; group.checked++;
      await db.update(targets).set({ lastCheckedAt: new Date(), ...(o.state !== "unknown" ? { liveNow: o.state === "live", viewers: o.viewers } : {}) }).where(eq(targets.username,seed.username));
      await db.update(liveRooms).set({ probedAt: new Date() }).where(eq(liveRooms.username,seed.username));
      if (o.state === "unknown") { report.unknown++; continue; }
      if (o.state === "offline") {
        report.offline++; await markOffline(seed.username, o.roomId || seed.roomId);
        await db.update(liveRooms).set({ lastSeenAt: new Date() }).where(eq(liveRooms.username,seed.username)); continue;
      }
      if (seen.has(o.roomId)) continue;
      seen.add(o.roomId);
      const meta = { username: seed.username, roomId: o.roomId, nickname: o.nickname, title: o.title, viewers: o.viewers };
      const inserted = await enqueueVerifiedRoom({ ...meta, source: seed.source, avatar: o.avatar,
        region: o.hostRegion || seed.region, regionBasis: o.hostRegion ? "room" : seed.regionBasis });
      if (inserted.firstHost) report.firstHosts = (report.firstHosts ?? 0) + 1;
      report.verified++; group.verified++; if (inserted.newRoom) { report.newRooms++; group.newRooms++; } else report.repeatedRooms++;
      for (const fields of o.rewards) {
        if (fields.roomId && fields.roomId !== o.roomId) continue;
        const row = await recordChest(fields,meta,"room-info");
        if (row) await bumpRoomChest(row.username,row.coins,row.slots,deriveChest(row).ratio);
      }
    }
    common.error = `${report.newRooms} yeni oda (${report.firstHosts ?? 0} ilk kez canlı görülen hesap) · ${report.repeatedRooms} yeniden doğrulanan · ${report.unknown} belirsiz.`;
  } catch (e) { common.error = "Tur kısmen tamamlandı."; report.errors.push(message(e)); }
  finally {
    clearInterval(beat);
    try {
      await expireOldChests();
      const [found] = await db.select({ n: sql<number>`count(*)::int` }).from(chests).where(gt(chests.detectedAt, scan.startedAt));
      Object.assign(common, { checked: report.checked, liveFound: report.verified, queued: report.newRooms, eulerRequests: report.eulerRequests, chestsFound: found.n });
      await db.update(radarScans).set({ finishedAt: new Date(), checked: report.checked, liveFound: report.verified, chestsFound: found.n, report, error: common.error }).where(eq(radarScans.id,scan.id));
      await db.insert(activityLog).values({ kind: "radar", message: `Keşif: ${report.checked} kontrol · ${report.newRooms} yeni oda · ${report.repeatedRooms} bilinen oda.`,
        meta: { scanId: scan.id, eulerRequests: report.eulerRequests, publicRequests: common.publicRequests, regionRequests: report.markets.filter(m=>m.requests).map(m=>m.region) } });
      await db.delete(cohostCandidates).where(lt(cohostCandidates.seenAt, new Date(Date.now()-24*60*MIN)));
    } finally { await db.update(providerGates).set({ reason: "Turlar arası bekleme", nextAt: new Date(Date.now()+30_000) }).where(gate); }
  }
  return common;
}

export async function recentScans(limit = 10) { return db.select().from(radarScans).orderBy(desc(radarScans.id)).limit(limit); }
export async function getScannerStatus() {
  const [settings, [last], [lock], overview] = await Promise.all([getSettings(), db.select().from(radarScans).where(isNotNull(radarScans.finishedAt)).orderBy(desc(radarScans.id)).limit(1),
    db.select().from(providerGates).where(eq(providerGates.provider,"discovery-run")), radarOverview()]);
  const seconds = interval(settings.scanIntervalSeconds);
  return { running: Boolean(lock && lock.reason.startsWith("scan:") && +lock.nextAt > Date.now()), lastRunAt: last?.finishedAt?.toISOString() ?? null,
    nextRunAt: settings.autoScan && last?.finishedAt ? new Date(+last.finishedAt + seconds*1000).toISOString() : null, autoScan: settings.autoScan,
    lastResult: last ? { checked: last.checked, liveFound: last.liveFound, chestsFound: last.chestsFound, source: last.source, error: last.error } : null,
    intervalSeconds: seconds, maxRooms: localCapacity(settings), listening: overview.listening, lastRegionSummary: null,
    scope: { regions: last?.report?.selected ?? [], regionCoverage: "sample", eulerAvailable: eulerFeedEnabled() } };
}
export async function scannerDashboard() {
  const [status, scans, overview, tasks] = await Promise.all([getScannerStatus(),recentScans(8),radarOverview(),
    db.select({ id: listenerJobs.id, username: listenerJobs.username, roomId: listenerJobs.roomId,
      status: sql<string>`case when ${listenerJobs.status} in ('connecting','listening') and ${listenerJobs.leaseUntil} < now() then 'queued' else ${listenerJobs.status} end`,
      viewerCount: listenerJobs.viewers, nextAttemptAt: listenerJobs.nextAttemptAt, connectedAt: listenerJobs.connectedAt, error: listenerJobs.lastError })
      .from(listenerJobs).innerJoin(liveRooms,and(eq(liveRooms.roomId,listenerJobs.roomId),eq(liveRooms.username,listenerJobs.username)))
      .where(freshRoom).orderBy(sql`${listenerJobs.connectedAt} desc nulls last`,asc(listenerJobs.nextAttemptAt)).limit(100)]);
  return { status, scans, overview, tasks };
}
