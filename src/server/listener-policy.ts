import { obj, type QuotaSample } from "@/lib/discovery-model";

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
// These are Arena's conservative local budgets, not a promise of upstream capacity.
// Distinct from the number of concurrently OPEN WebSockets. Provider denials always take priority.
export const START_WINDOWS = [{ span: MIN, max: 3 }, { span: HOUR, max: 24 }, { span: DAY, max: 80 }];
export function localCapacity(settings: { listenToAll: boolean; scanConcurrency: number }) {
  const value = Number(process.env.ARENA_LISTENER_CEILING ?? 24);
  const ceiling = Number.isSafeInteger(value) && value > 0 ? Math.min(value, 64) : 24;
  const configured = Number(settings.scanConcurrency);
  return settings.listenToAll ? ceiling : Math.min(ceiling, Math.max(1, Number.isSafeInteger(configured) ? configured : 5));
}
export function nextStart(starts: number[], now: number, quota?: QuotaSample | null) {
  const active = starts.filter(t => Number.isFinite(t) && t > now - DAY).sort((a,b) => a-b);
  let next = now;
  for (const { span, max } of START_WINDOWS) {
    const used = active.filter(t => t > now - span);
    if (used.length >= max) next = Math.max(next, used[used.length - max] + span + 50);
  }
  for (const w of quota?.windows ?? []) {
    const span = w.period === "minute" ? MIN : w.period === "hour" ? HOUR : DAY;
    const reset = w.resetAt ?? (quota!.at + span);
    if (reset <= now) continue;
    const since = active.filter(t => t >= quota!.at && t > now - span);
    if (since.length >= w.remaining) next = Math.max(next, reset + 1000);
  }
  return { active, next };
}
export function failurePolicy(error: unknown, attempts: number) {
  const e = obj(error);
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : String(e.message ?? "");
  const rate = e.reason === "Rate Limited" || /rate.?limit|too many connections|\b429\b/i.test(message);
  if (rate) {
    // tiktok-live-connector 2.5: retryAfter is milliseconds; resetTime is Unix milliseconds.
    const fallback = /(?:_day|daily)/i.test(message) ? DAY : /(?:_hour|hourly)/i.test(message) ? HOUR : 5 * MIN;
    const ms = Math.max(Number(e.retryAfter) || 0, (Number(e.resetTime) || 0) - Date.now());
    return { wait: ms > 0 ? Math.max(1000, ms + 1000) : fallback, shared: true, offline: false, detail: "İmzalama kotası dolu." };
  }
  if (e.reason === "Premium Feature" || /Business plan|\b(401|403)\b|not entitled/i.test(message)) return { wait: HOUR, shared: true, offline: false, detail: "Sağlayıcı bu bağlantıya izin vermedi." };
  if (e.name === "UserOfflineError" || /isn't online|not live|offline/i.test(message)) return { wait: 0, shared: false, offline: true, detail: "Yayın sona erdi." };
  return { wait: Math.min(5 * MIN, 10_000 * 2 ** Math.min(Math.max(0, attempts), 5)), shared: false, offline: false, detail: "Bağlantı kurulamadı veya kesildi." };
}
