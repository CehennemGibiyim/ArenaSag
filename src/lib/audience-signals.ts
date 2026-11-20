// Audience signals only produce *candidate* handles. A gifter or chatter is never the host of the room
// they were seen in; the scanner still has to verify each candidate as a live room before it is watched.
import { cleanHandle, obj, roomKey } from "@/lib/discovery-model";

export type AudienceSignal = {
  username: string;
  nickname: string;
  roomId: string;
  gifts: number;
  diamonds: number;
  messages: number;
};

export type AudiencePick = AudienceSignal & { score: number };

export const AUDIENCE_MIN_MESSAGES = 3;
export const AUDIENCE_MAX_CANDIDATES = 8;
const LIMIT = { gifts: 500, diamonds: 5_000_000, messages: 400 };

function count(value: unknown, max: number) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.min(max, Math.floor(n)) : 0;
}

/** Reads only identity fields from a Webcast user object; never a host role. */
export function audienceUser(raw: unknown) {
  const user = obj(obj(raw).user);
  return {
    username: cleanHandle(user.uniqueId ?? user.unique_id ?? user.displayId ?? user.display_id),
    nickname: typeof user.nickname === "string" ? user.nickname.trim().slice(0, 80) : "",
    roomId: roomKey(user.roomId ?? user.room_id),
  };
}

export function giftSignal(raw: unknown): AudienceSignal | null {
  const user = audienceUser(raw);
  if (!user.username) return null;
  const item = obj(raw);
  const gift = obj(item.giftDetails ?? item.gift_details);
  const diamonds = count(gift.diamondCount ?? gift.diamond_count ?? item.diamondCount ?? item.diamond_count, LIMIT.diamonds);
  return { ...user, gifts: 1, diamonds, messages: 0 };
}

export function chatSignal(raw: unknown): AudienceSignal | null {
  const user = audienceUser(raw);
  if (!user.username) return null;
  const comment = obj(raw).comment;
  if (typeof comment !== "string" || !comment.trim()) return null;
  return { ...user, gifts: 0, diamonds: 0, messages: 1 };
}

/** Accumulates a session's signals in place, with hard caps so a huge room cannot grow memory forever. */
export function mergeAudienceSignal(signals: Map<string, AudienceSignal>, signal: AudienceSignal | null, maxTracked = 512) {
  if (!signal || !signal.username) return;
  const old = signals.get(signal.username);
  if (!old) {
    if (signals.size >= Math.max(1, maxTracked)) return;
    signals.set(signal.username, { ...signal });
    return;
  }
  old.gifts = Math.min(LIMIT.gifts, old.gifts + signal.gifts);
  old.diamonds = Math.min(LIMIT.diamonds, old.diamonds + signal.diamonds);
  old.messages = Math.min(LIMIT.messages, old.messages + signal.messages);
  if (!old.nickname && signal.nickname) old.nickname = signal.nickname;
  if (!old.roomId && signal.roomId) old.roomId = signal.roomId;
}

/**
 * A single gift is enough (spenders are a strong live-audience signal); chatters need a few messages so
 * ordinary viewers and emoji spam do not flood the watch list. The host is always excluded.
 */
export function pickAudienceCandidates(signals: Iterable<AudienceSignal>, host: string, limit = AUDIENCE_MAX_CANDIDATES): AudiencePick[] {
  const own = cleanHandle(host);
  const rows: AudiencePick[] = [];
  for (const signal of signals) {
    if (!signal.username || signal.username === own) continue;
    if (signal.gifts < 1 && signal.messages < AUDIENCE_MIN_MESSAGES) continue;
    const score = Math.max(1, Math.min(100, 45 + signal.gifts * 5 + Math.floor(signal.diamonds / 100) + signal.messages));
    rows.push({ ...signal, score });
  }
  return rows
    .sort((a, b) => b.score - a.score || b.diamonds - a.diamonds || a.username.localeCompare(b.username))
    .slice(0, Math.max(1, Math.min(32, limit)));
}

export function audienceNote(signal: AudienceSignal) {
  const parts: string[] = [];
  if (signal.gifts) parts.push(`${signal.gifts} hediye`);
  if (signal.diamonds) parts.push(`${signal.diamonds} elmas`);
  if (signal.messages) parts.push(`${signal.messages} sohbet`);
  return `İzleyici sinyali${parts.length ? ` · ${parts.join(" · ")}` : ""}`;
}
