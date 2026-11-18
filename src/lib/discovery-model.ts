// Shared data contracts only. No credentials or server dependencies in the client bundle.
export type RegionBasis = "unknown" | "sample" | "market" | "room" | "directory";
export type Candidate = {
  username: string; nickname: string; roomId: string; region: string; regionBasis: RegionBasis; source: string;
};
export type FeedState = "ok" | "empty" | "limited" | "error" | "loading" | "disabled";
export type MarketRead = { region: string; state: FeedState; cached: boolean; requests: number; candidates: number; detail: string };
export type SourceRead = {
  id: string; candidates: number; checked: number; verified: number; newRooms: number; requests: number;
  cached: number; state: FeedState; detail: string;
};
export type DiscoveryReport = {
  version: 1; selected: string[]; supported: number; markets: MarketRead[]; sources: SourceRead[];
  checked: number; newRooms: number; firstHosts?: number; repeatedRooms: number; verified: number; offline: number; unknown: number;
  deferred: number; errors: string[]; eulerRequests: number; registryRequests: number;
};
export const SOURCE_LABELS: Record<string, string> = {
  "public-sample": "Tik.Tools", tikwm: "TikWM", cohost: "Ortak yayın", saved: "İzleme havuzu",
  directory: "Yayıncı dizini", euler: "EulerStream", pinned: "Sabitlenen hesap", targets: "Kayıtlı hesap", manual: "Elle eklendi",
  check: "Canlı kontrolü", discovered: "Önceki keşif", scan: "İzleme havuzu", watchlist: "İzleme listesi",
};
export const STATE_LABELS: Record<string, string> = {
  queued: "Sırada", connecting: "Bağlanıyor", listening: "Dinleniyor", retry: "Tekrar bekliyor", verified: "Doğrulandı",
  ok: "Yanıt alındı", empty: "Boş yanıt", limited: "Kota bekleniyor", error: "Alınamadı", disabled: "Kapalı", loading: "Okunuyor",
};
export function cleanHandle(value: unknown) {
  if (typeof value !== "string") return "";
  const name = value.trim().replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,24}$/.test(name) ? name : "";
}
export function roomKey(value: unknown) { return typeof value === "string" && /^\d{10,20}$/.test(value) ? value : ""; }
export function countryCode(value: unknown) {
  const code = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (code === "UK") return "GB";
  return /^[A-Z]{2}$/.test(code) && !["ZZ", "XX"].includes(code) ? code : "";
}
const names = new Intl.DisplayNames(["tr"], { type: "region", fallback: "code" });
export function countryName(value: string) { const code = countryCode(value); return code ? names.of(code) || code : "Bilinmiyor"; }
export function obj(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function asCandidate(username: unknown, nickname: unknown, roomId: unknown, region: unknown, basis: RegionBasis, source: string): Candidate | null {
  const handle = cleanHandle(username); if (!handle) return null;
  const code = countryCode(region);
  return { username: handle, nickname: typeof nickname === "string" ? nickname.slice(0, 100) : handle,
    roomId: roomKey(roomId), region: code, regionBasis: code ? basis : "unknown", source };
}
export function uniqueCandidates(list: (Candidate | null)[]) {
  const out = new Map<string, Candidate>();
  for (const row of list) if (row && !out.has(row.username)) out.set(row.username, row);
  return [...out.values()];
}
export function parseTicker(value: unknown) {
  const rows = obj(value).channels;
  if (!Array.isArray(rows)) throw new Error("Açık listenin yanıt biçimi tanınmadı.");
  return uniqueCandidates(rows.slice(0, 10).map(v => { const r = obj(v); return asCandidate(r.uniqueId, r.displayName, r.roomId, r.region, "sample", "public-sample"); }));
}
export function parseTrendAuthors(value: unknown, market: string) {
  const data = obj(value);
  if (data.code !== 0 || !Array.isArray(data.data)) throw new Error("TikWM geçerli bir video listesi döndürmedi.");
  // The requested trend MARKET, not a host location. Video IDs, counts and titles are never LIVE metadata.
  return uniqueCandidates(data.data.slice(0, 12).map(v => { const a = obj(obj(v).author); return asCandidate(a.unique_id, a.nickname, "", market, "market", "tikwm"); }));
}
export function battlePeers(raw: unknown, ownRoom: string) {
  const entries = obj(raw).anchorsInfo;
  if (!Array.isArray(entries)) return [];
  return uniqueCandidates(entries.slice(0, 8).map(v => { const user = obj(obj(obj(v).value).user); const rid = roomKey(user.roomId);
    return rid && rid !== ownRoom ? asCandidate(user.displayId, user.nickName, rid, "", "unknown", "cohost") : null; }));
}
export function retryDelay(value: string | null | undefined, now = Date.now()) {
  if (!value) return 0;
  const ms = /^\d+(\.\d+)?$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) ? Math.max(0, Math.min(365 * 86_400_000, ms)) : 0;
}
export function chooseMarkets(all: string[], wanted: string[], reads: Map<string, number>, budget = 4) {
  const included = new Set(wanted);
  return [...new Set(all)].filter(k => !included.size || included.has(k))
    .sort((a, b) => (reads.get(a) ?? 0) - (reads.get(b) ?? 0)).slice(0, budget);
}

/** Public historical handles only. Ignore archived room IDs, live flags, viewers, boxes and monetary fields. */
export function parseDirectory(value: unknown) {
  const rows = obj(value).targets;
  if (!Array.isArray(rows)) throw new Error("Yayıncı dizini tanınmadı.");
  return uniqueCandidates(rows.slice(0, 12_000).map(v => { const r = obj(v); return asCandidate(r.username,r.username,"",r.country,"directory","directory"); }));
}
export function directoryBatch(rows: Candidate[], selected: string[], round: number, size = 24) {
  const select = new Set(selected), groups = new Map<string,Candidate[]>();
  for (const row of rows) { if (select.size && !select.has(row.region)) continue; const g = groups.get(row.region) ?? []; g.push(row); groups.set(row.region,g); }
  const buckets = [...groups.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([,v]) => v.sort((a,b) => a.username.localeCompare(b.username)));
  const ordered: Candidate[] = [];
  for (let i = 0; buckets.some(g=>i<g.length); i++) for (const g of buckets) if (i<g.length) ordered.push(g[i]);
  return Array.from({ length: Math.min(size,ordered.length) },(_,i)=> ordered[((Math.max(1,round)-1)*size+i) % ordered.length]);
}

export type QuotaWindow = { period: "minute" | "hour" | "day"; max: number; remaining: number; resetAt: number | null };
export type QuotaSample = { at: number; windows: QuotaWindow[] };
export function parseQuota(value: unknown, at = Date.now()): QuotaSample {
  const payload = obj(value); if (payload.code !== 200) throw new Error("Kota yanıtı tanınmadı.");
  const windows: QuotaWindow[] = [];
  for (const period of ["minute", "hour", "day"] as const) {
    const v = obj(payload[period]);
    if (typeof v.max !== "number" || !Number.isSafeInteger(v.max) || v.max < 0 || typeof v.remaining !== "number" || !Number.isSafeInteger(v.remaining) || v.remaining < 0 || v.remaining > v.max) continue;
    const date = typeof v.reset_at === "string" && v.reset_at ? Date.parse(v.reset_at) : NaN;
    windows.push({ period, max: v.max, remaining: v.remaining, resetAt: Number.isFinite(date) ? date : null });
  }
  if (!windows.length) throw new Error("Kota alanları yok.");
  return { at, windows };
}
