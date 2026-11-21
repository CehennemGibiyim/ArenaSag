#!/usr/bin/env node
/**
 * Zarf ödülü → sandık kaydı.
 *
 * `radar-publish.mjs` bu dönüşümü iki yoldan kullanır: WebSocket dinleyicisinin
 * yakaladığı zarf ve `room/info` turunda görülen zarf. Mantık burada tek yerde
 * durur ki yayın betiği ile replay testi (`tests/envelope-replay.test.mjs`)
 * aynı kuralları çalıştırsın; test gerçek bir `WebcastEnvelopeMessage` karesini
 * kotasız olarak sandık kaydına çevirir.
 */

const integer = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

/** businessType -> okunabilir ad (tik.tools: 1 sandık, 19 süper hayran, 20 spark). */
export const BUSINESS_LABELS = { 1: "coins", 19: "super_fan_box", 20: "spark_box" };

/**
 * Sandık görünümü. `skinId` yalnızca süslemedir: 0 varsayılan sandık derisidir,
 * bu yüzden normal sandık sayılır. Çanta/mektup ayrımı kapsayıcı adından gelir.
 */
export function variantOf(skinId, container = "") {
  if (/letter|parcel|mektup/i.test(container)) return { kind: "letter", variant: "letter" };
  if (/goody|bag/i.test(container)) return { kind: "bag", variant: `l${Number(skinId) || 0}` };
  if (Number(skinId) === 2) return { kind: "chest", variant: "gold" };
  if (Number(skinId) === 3) return { kind: "chest", variant: "hanging" };
  return { kind: "chest", variant: "normal" };
}

/** Ödülü yayınlanacak sandık satırına çevirir; `previousRow` görülme sayacını taşır. */
export function buildChestRecord(reward, stream, { previousRow = null, now = Date.now() } = {}) {
  const opensMs = Number(reward?.opensAt) * 1000;
  const nowIso = new Date(now).toISOString();
  const { kind, variant } = variantOf(reward?.skinId, reward?.container);
  const coins = integer(reward?.coins);
  const slots = integer(reward?.slots);
  const businessType = integer(reward?.businessType);
  return {
    envelopeId: reward.envelopeId,
    kind,
    variant,
    skinId: integer(reward.skinId),
    businessType,
    businessLabel: BUSINESS_LABELS[businessType] ?? "coins",
    labels: reward.container ? [reward.container] : [],
    username: stream.username,
    nickname: stream.nickname,
    title: stream.title,
    roomId: stream.roomId,
    coins,
    slots,
    ratio: Math.round((coins / Math.max(1, slots)) * 100) / 100,
    viewers: integer(stream.viewers),
    opensAt: new Date(opensMs).toISOString(),
    status: opensMs > now ? "waiting" : "open",
    detectedAt: previousRow?.detectedAt || nowIso,
    lastSeenAt: nowIso,
    seenCount: integer(previousRow?.seenCount) + 1,
    missingCount: 0,
    closedAt: "",
    openUrl: `https://www.tiktok.com/@${stream.username}/live`,
    deepLink: `snssdk1233://live?room_id=${stream.roomId}`,
  };
}

/**
 * Ödülü sandık haritasına yazar.
 * @returns {{row: object, isNew: boolean} | null} odası eşleşmeyen ödülde null
 */
export function applyChestReward(chests, reward, stream, { now = Date.now() } = {}) {
  if (reward?.roomId && reward.roomId !== stream?.roomId) return null;
  const previousRow = chests.get(reward.envelopeId);
  const row = buildChestRecord(reward, stream, { previousRow, now });
  chests.set(reward.envelopeId, row);
  return { row, isNew: !previousRow };
}
