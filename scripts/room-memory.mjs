#!/usr/bin/env node
/**
 * Oda verimliliği ve güvenilirlik hafızası.
 *
 * Dinleyici her oda için kaç kez bağlantı denediğini, kaç kez bağlandığını,
 * kaç kez 429 aldığını ve kaç zarf ürettiğini biriktirir. Bu kayıt
 * `arena-live.json` içinde `roomMemory` olarak yayınlanır; sonraki turun shard
 * seçimi aynı kaydı kullanır. Böylece sayaçlar yalnızca tek koşunun artifact'ında
 * kalmaz.
 *
 * Sıralama bilerek yumuşatılmıştır: az verili bir oda hemen "iyi" sayılmaz,
 * tek bir 429 eski geçmişi tamamen silmez ve uzun süre görülmeyen kayıtlar
 * etkisini kaybeder. Amaç yeni odaları tamamen dışlamadan güvenilir/getirili
 * odaları öne almaktır.
 */
const DAY_MS = 86_400_000;
export const ROOM_MEMORY_MAX_AGE_MS = 45 * DAY_MS;
export const ROOM_MEMORY_MAX_ROOMS = 600;

const COUNT_KEYS = ["attempts", "connected", "failed", "rateLimitHits", "envelopes"];
const DATE_KEYS = ["lastAttemptAt", "lastConnectedAt", "lastRateLimitedAt", "lastEnvelopeAt"];
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const count = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};
const iso = (value) => {
  const text = typeof value === "string" ? value.trim() : "";
  return text && Number.isFinite(Date.parse(text)) ? text : null;
};

/** Yeni bir oda kaydı; alanlar bilinçli olarak sabit tutulur. */
export function emptyRoomHistory() {
  return {
    attempts: 0,
    connected: 0,
    failed: 0,
    rateLimitHits: 0,
    envelopes: 0,
    lastAttemptAt: null,
    lastConnectedAt: null,
    lastRateLimitedAt: null,
    lastEnvelopeAt: null,
  };
}

function normalizeEntry(value) {
  const source = obj(value);
  const entry = emptyRoomHistory();
  for (const key of COUNT_KEYS) entry[key] = count(source[key]);
  for (const key of DATE_KEYS) entry[key] = iso(source[key]);
  return entry;
}

function dateMs(value) {
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function later(a, b) {
  if (!a) return b;
  if (!b) return a;
  return dateMs(a) >= dateMs(b) ? a : b;
}

function activityAt(entry) {
  let latest = 0;
  for (const key of DATE_KEYS) latest = Math.max(latest, dateMs(entry[key]));
  return latest || null;
}

/**
 * Önceki kalıcı hafızayı yeni koşunun oda kayıtlarıyla birleştirir.
 * Sayaçlar toplanır, tarihler en yenisiyle güncellenir; eski kayıtlar budanır.
 */
export function mergeRoomMemory(
  previous,
  current,
  { now = Date.now(), maxAgeMs = ROOM_MEMORY_MAX_AGE_MS, limit = ROOM_MEMORY_MAX_ROOMS } = {},
) {
  const merged = {};
  for (const source of [previous, current]) {
    for (const [rawId, value] of Object.entries(obj(source))) {
      const id = String(rawId).trim();
      if (!id) continue;
      const entry = normalizeEntry(value);
      const target = merged[id];
      if (!target) {
        merged[id] = entry;
        continue;
      }
      for (const key of COUNT_KEYS) target[key] += entry[key];
      for (const key of DATE_KEYS) target[key] = later(target[key], entry[key]);
    }
  }

  const nowMs = Number.isFinite(now) ? now : Date.now();
  for (const [id, entry] of Object.entries(merged)) {
    const seenAt = activityAt(entry);
    if (seenAt !== null && nowMs - seenAt > maxAgeMs) delete merged[id];
  }

  const rows = Object.entries(merged).sort((a, b) => {
    const at = activityAt(b[1]) ?? 0;
    const bt = activityAt(a[1]) ?? 0;
    return at - bt || a[0].localeCompare(b[0]);
  });
  const cap = Number.isFinite(limit) && limit > 0 ? limit : rows.length;
  return Object.fromEntries(rows.slice(0, cap));
}

/**
 * Bir odanın öncelik puanı. Bağlantı başarısı ve zarf getirisi yükseltir;
 * 429 oranı düşürür. Puan, geçmişi olmayan odaların tamamen geride kalmaması
 * için düşük ama sıfır olmayan bir tabandan başlar.
 */
export function roomPriority(value, now = Date.now()) {
  const entry = normalizeEntry(value);
  const attempts = entry.attempts;
  const connected = Math.min(attempts, entry.connected);
  const reliability = Math.min(1, (connected + 1) / (attempts + 2));
  const yieldRate = Math.min(1, (entry.envelopes + 0.25) / (connected + 1));
  const rateLimitRate = Math.min(1, entry.rateLimitHits / Math.max(1, attempts));
  const last = activityAt(entry);
  const ageDays = last === null ? 0 : Math.max(0, (now - last) / DAY_MS);
  const freshness = last === null ? 0.75 : 1 / (1 + ageDays / 30);
  const score = reliability * (0.15 + 0.85 * yieldRate) - 0.35 * rateLimitRate;
  return Math.max(0, score) * (0.6 + 0.4 * freshness);
}
