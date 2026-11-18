import { eq, like, sql } from "drizzle-orm";
import { db } from "@/db";
import { discoveryCache, providerGates } from "@/db/schema";
import { chooseMarkets, countryCode, obj, parseQuota, type QuotaSample, parseDirectory, parseTicker, parseTrendAuthors, retryDelay, uniqueCandidates, type Candidate, type FeedState, type MarketRead } from "@/lib/discovery-model";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
type Data = { rows?: Candidate[]; codes?: string[]; quota?: QuotaSample };
type Read = { quota?: QuotaSample | null; rows: Candidate[]; codes: string[]; state: FeedState; detail: string; cached: boolean; requests: number };
type Source = { key: string; group: string; url: string; ttl: number; spacing: number; headers?: Record<string,string>; parse: (body: unknown) => Data };
export const eulerFeedEnabled = () => process.env.ARENA_ENABLE_EULER_FEED === "1" && Boolean(process.env.EULER_API_KEY?.trim());
export const signingKey = () => process.env.ARENA_ENABLE_KEYED_SIGNING === "1" ? process.env.EULER_API_KEY?.trim() : undefined;

class SourceFailure extends Error {
  constructor(message: string, readonly wait: number, readonly state: FeedState, readonly groupPause: boolean) { super(message); }
}
const emptyRead = (state: FeedState, detail: string): Read => ({ rows: [], codes: [], state, detail, cached: false, requests: 0 });
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function pauseProvider(provider: string, duration: number, reason: string) {
  const nextAt = new Date(Date.now() + duration);
  await db.transaction(async tx => {
    if (provider === "listener") await tx.execute(sql`select pg_advisory_xact_lock(61720401)`);
    else await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`arena:source:${provider}`}))`);
    await tx.insert(providerGates).values({ provider, nextAt, reason }).onConflictDoUpdate({ target: providerGates.provider,
    set: { nextAt: sql`greatest(${providerGates.nextAt}, excluded.next_at)`, reason: sql`case when excluded.next_at >= ${providerGates.nextAt} then excluded.reason else ${providerGates.reason} end` } });
  });
}

async function readSource(source: Source): Promise<Read> {
  // Reserve a request under a short DB lock; never hold the transaction over the network.
  const reserve = () => db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`arena:source:${source.group}`}))`);
    const [row] = await tx.select().from(discoveryCache).where(eq(discoveryCache.key, source.key));
    const now = Date.now();
    if (row && row.nextAt.getTime() > now) return { read: { rows: row.rows, codes: row.codes, quota: row.quota, cached: true, requests: 0,
      state: row.state as FeedState, detail: row.detail } };
    const [gate] = await tx.select().from(providerGates).where(eq(providerGates.provider, source.group));
    if (gate && gate.nextAt.getTime() > now) return { wait: gate.nextAt.getTime() - now, reason: gate.reason };
    const nextAt = new Date(now + Math.max(20_000, Math.min(source.ttl, source.spacing)));
    const marker = { quota: null, rows: [], codes: [], state: "loading", detail: "Kaynak okunuyor.", nextAt, updatedAt: new Date(now) };
    await tx.insert(discoveryCache).values({ key: source.key, ...marker }).onConflictDoUpdate({ target: discoveryCache.key, set: marker });
    await tx.insert(providerGates).values({ provider: source.group, nextAt: new Date(now + source.spacing), reason: "pace" })
      .onConflictDoUpdate({ target: providerGates.provider, set: { nextAt: new Date(now + source.spacing), reason: "pace" } });
    return { reserved: true };
  });
  for (let i = 0; i < 4; i++) {
    const decision = await reserve();
    if (decision.read) return decision.read;
    if (decision.reserved) break;
    if (decision.reason !== "pace" || (decision.wait ?? 0) > 2500 || i === 3) return emptyRead("limited", `Bu kaynak için bekleniyor (${Math.ceil((decision.wait ?? 0) / 1000)} sn).`);
    await wait((decision.wait ?? 1500) + 30);
  }
  let result: Read = { ...emptyRead("empty", "Liste boş döndü."), requests: 1 };
  let ttl = source.ttl;
  try {
    const response = await fetch(source.url, { cache: "no-store", headers: { Accept: "application/json", ...source.headers },
      redirect: "error", signal: AbortSignal.timeout(9000) });
    if (!response.ok) {
      const waitMs = Math.max(5 * MIN, retryDelay(response.headers.get("retry-after")));
      throw new SourceFailure(`HTTP ${response.status}`, waitMs, response.status === 429 ? "limited" : "error", [401,403,429].includes(response.status));
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Boş yanıt.");
    const parts: Uint8Array[] = []; let length = 0;
    try { while (true) { const chunk = await reader.read(); if (chunk.done) break;
      length += chunk.value.byteLength; if (length > 8_000_000) { await reader.cancel(); throw new Error("Kaynak boyut sınırını aştı."); } parts.push(chunk.value); }
    } finally { reader.releaseLock(); }
    const raw: unknown = JSON.parse(Buffer.concat(parts).toString("utf8"));
    const body = obj(raw);
    if (body.code !== undefined && body.code !== 0 && /limit|too many/i.test(String(body.msg ?? "")))
      throw new SourceFailure("Sağlayıcı istek sınırı bildirdi.", 5 * MIN, "limited", true);
    const data = source.parse(raw);
    result.quota = data.quota; result.rows = data.rows ?? []; result.codes = data.codes ?? [];
    if (result.rows.length || result.codes.length || result.quota) { result.state = "ok"; result.detail = ""; }
  } catch (e) {
    const failure = e instanceof SourceFailure ? e : new SourceFailure(e instanceof SyntaxError ? "Yanıt JSON değil." : "Kaynağa ulaşılamadı veya yanıt biçimi değişti.", 5 * MIN, "error", false);
    result.state = failure.state; result.detail = failure.message;
    ttl = Math.max(source.group === "ticker" ? 5 * MIN : MIN, failure.wait);
    if (failure.groupPause) await pauseProvider(source.group, failure.wait, failure.message);
  }
  await db.update(discoveryCache).set({ quota: result.quota ?? null, rows: result.rows, codes: result.codes, state: result.state, detail: result.detail,
    nextAt: new Date(Date.now() + ttl), updatedAt: new Date() }).where(eq(discoveryCache.key, source.key));
  return result;
}

export function tickerSample() {
  return readSource({ key: "tiktools:public", group: "ticker", ttl: 5 * MIN, spacing: 5 * MIN,
    url: "https://api.tik.tools/api/live/top-channels", parse: value => ({ rows: parseTicker(value) }) });
}
export function countryRegistry() {
  return readSource({ key: "tikwm:registry", group: "tikwm", ttl: DAY, spacing: 1500, url: "https://www.tikwm.com/api/region", parse: value => {
    const response = obj(value);
    if (response.code !== 0) throw new Error("Ülke listesi alınamadı.");
    const codes = Object.keys(obj(response.data)).map(countryCode).filter(Boolean);
    if (!codes.length) throw new Error("Ülke listesi boş.");
    // Stable order; initial cycle starts with TR, then visits the least-recently-read country.
    return { codes: [...new Set(codes)].sort((a,b) => a === "TR" ? -1 : b === "TR" ? 1 : a.localeCompare(b)) };
  } });
}
export async function regionalSamples(wanted: string[]) {
  const registry = await countryRegistry();
  const history = await db.select({ key: discoveryCache.key, at: discoveryCache.updatedAt }).from(discoveryCache).where(like(discoveryCache.key, "tikwm:market:%"));
  const last = new Map(history.map(r => [r.key.slice("tikwm:market:".length), r.at.getTime()]));
  const codes = chooseMarkets(registry.codes, wanted, last);
  const markets: MarketRead[] = [];
  const rows: Candidate[] = [];
  for (const region of codes) {
    const result = await readSource({ key: `tikwm:market:${region}`, group: "tikwm", ttl: 15 * MIN, spacing: 1500,
      url: `https://www.tikwm.com/api/feed/list?region=${encodeURIComponent(region)}&count=12`, parse: value => ({ rows: parseTrendAuthors(value, region) }) });
    markets.push({ region, state: result.state, requests: result.requests, cached: result.cached, candidates: result.rows.length, detail: result.detail });
    rows.push(...result.rows);
    if (result.state === "limited" || (result.state === "error" && /^HTTP (401|403)/.test(result.detail))) break;
  }
  const unsupported = wanted.filter(region => !registry.codes.includes(region));
  return { rows: uniqueCandidates(rows), markets, registry, unsupported };
}

/** A public creator-maintained watchlist (not a live feed), refreshed at most once an hour. */
export function publicDirectory() {
  return readSource({ key: "directory:targets", group: "directory", ttl: 60 * MIN, spacing: MIN,
    url: "https://raw.githubusercontent.com/CehennemGibiyim/TikTok/main/site/firsat/data/targets.json",
    parse: value => { const rows = parseDirectory(value); return { rows, codes: [...new Set(rows.map(r=>r.region).filter(Boolean))].sort() }; } });
}

export function signingQuota() {
  const key = signingKey();
  return readSource({ key: `signer:quota:${key ? "keyed" : "anon"}`, group: "quota-read", ttl: 5*MIN, spacing: MIN,
    url: "https://api.eulerstream.com/webcast/rate_limits", headers: key ? { "x-api-key": key } : undefined,
    parse: value => ({ quota: parseQuota(value) }) });
}
