/**
 * Üye defteri sayfalama yardımcıları.
 *
 * Defter `lastSeen`'e göre azalan sıralı yayınlandığı için "ilk N kayıt"
 * yaklaşımı, defter büyüdükçe eski üyeleri sonsuza kadar dışarıda bırakıyordu.
 * Burada defter `firstSeen` artan sıraya çevrilir ve imleçle sayfalanır: her
 * turda bir sonraki dilim işlenir, sona gelince başa döner. Böylece defter ne
 * kadar büyürse büyüsün herkes sonunda PostgreSQL'e girer.
 */

export type RosterMember = {
  username?: string;
  nickname?: string;
  avatar?: string;
  region?: string;
  roomId?: string;
  firstSeen?: string;
  lastSeen?: string;
  lastLiveAt?: string;
  liveCount?: number;
};

/** Yayıncı "şu an canlı" sayılmak için son görülme penceresi. */
export const LIVE_WINDOW_MS = 30 * 60_000;

export function rosterHandle(value: unknown): string {
  const clean = String(value ?? "").trim().replace(/^@+/, "").toLowerCase();
  return /^[a-z0-9._]{1,24}$/.test(clean) ? clean : "";
}

/** Defteri deterministik sıraya koyar: en eski üye önce gelir. */
export function orderRoster(members: RosterMember[]): RosterMember[] {
  return [...members].sort((left, right) => {
    const leftAt = Date.parse(String(left.firstSeen ?? "")) || 0;
    const rightAt = Date.parse(String(right.firstSeen ?? "")) || 0;
    if (leftAt !== rightAt) return leftAt - rightAt;
    return rosterHandle(left.username).localeCompare(rosterHandle(right.username));
  });
}

export type RosterPage = {
  items: RosterMember[];
  nextCursor: number;
  wrapped: boolean;
  total: number;
};

/** İmleçten itibaren en fazla `pageSize` üye döndürür ve imleci ilerletir. */
export function pageRoster(members: RosterMember[], cursor: number, pageSize: number): RosterPage {
  const total = members.length;
  const limit = Math.max(1, Math.min(2000, Math.floor(Number(pageSize)) || 1));
  if (total === 0) return { items: [], nextCursor: 0, wrapped: false, total: 0 };
  const start = ((Math.floor(Number(cursor)) || 0) % total + total) % total;
  const count = Math.min(limit, total);
  const items = Array.from({ length: count }, (_, index) => members[(start + index) % total]);
  return { items, nextCursor: (start + count) % total, wrapped: start + count >= total, total };
}

export function rosterLiveState(member: RosterMember, nowMs = Date.now()): boolean {
  const at = Date.parse(String(member.lastLiveAt ?? ""));
  return Number.isFinite(at) && nowMs - at < LIVE_WINDOW_MS;
}
