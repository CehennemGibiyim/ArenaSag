import test from "node:test";
import assert from "node:assert/strict";
import { bagReward, envelopeWarnings, envelopeReward } from "../scripts/envelope-watch.mjs";

const now = () => Math.floor(Date.now() / 1000) + 120;

// Gerçek WebcastEnvelopeMessage biçimi: alanlar envelopeInfo altında, saniye cinsinden unpackAt.
const message = () => ({
  envelopeInfo: {
    envelopeId: "7300000000000000001",
    diamondCount: 500,
    peopleCount: 20,
    unpackAt: now(),
    skinId: 2,
    businessType: 1,
    roomId: "7300000000000000000",
  },
});

test("WebcastEnvelopeMessage sandık ödülüne çevrilir", () => {
  const reward = envelopeReward(message(), "7300000000000000009");
  assert.equal(reward.envelopeId, "7300000000000000001");
  assert.equal(reward.roomId, "7300000000000000000");
  assert.equal(reward.coins, 500);
  assert.equal(reward.slots, 20);
  assert.equal(reward.skinId, 2);
  assert.ok(reward.opensAt > 0);
});

test("oda kimliği mesajda yoksa dinlenen oda kullanılır", () => {
  const data = message();
  delete data.envelopeInfo.roomId;
  assert.equal(envelopeReward(data, "7300000000000000009").roomId, "7300000000000000009");
});

test("eksik veya geçersiz zarf alanları yok sayılır", () => {
  const noCoins = message();
  delete noCoins.envelopeInfo.diamondCount;
  assert.equal(envelopeReward(noCoins), null);
  assert.equal(envelopeReward({}), null);
  assert.equal(envelopeReward(null), null);
  const stale = message();
  stale.envelopeInfo.unpackAt = Math.floor(Date.now() / 1000) - 86_400;
  assert.equal(envelopeReward(stale), null);
});

test("mektup kapsayıcısı letter olarak işaretlenir", () => {
  const letter = { letterInfo: { envelopeId: "55", diamondCount: 30, peopleCount: 5, unpackAt: now() } };
  const reward = envelopeReward(letter, "7300000000000000009");
  assert.equal(reward.envelopeId, "letter:55");
  assert.equal(reward.skinId, 0);
});

test("anahtarsız imzalama ve kapalı dinleyici uyarı olarak döner", () => {
  const watch = {
    requested: 60,
    connected: 12,
    failed: 0,
    seconds: 300,
    envelopes: [],
    rateLimited: false,
    rateLimitHits: 0,
    signedWithKey: false,
    messageTypes: {},
  };
  const warnings = envelopeWarnings(watch, { rooms: 60, seconds: 300 });
  assert.ok(warnings.some((line) => line.includes("EULER_API_KEY")), warnings.join(" | "));
  assert.deepEqual(envelopeWarnings(null, { enabled: false }), [
    "WebSocket zarf dinleyicisi kapalı (ARENA_ENVELOPE_ROOMS=0).",
  ]);
  assert.ok(envelopeWarnings(null, { seconds: 0 })[0].includes("çalışmadı"));
});

test("kota dolduğunda dinlemenin durduğu açıkça söylenir", () => {
  const watch = {
    requested: 60,
    connected: 0,
    failed: 12,
    seconds: 40,
    envelopes: [],
    rateLimited: true,
    rateLimitHits: 12,
    signedWithKey: true,
    messageTypes: {},
  };
  const warnings = envelopeWarnings(watch, { rooms: 60, seconds: 40, apiKey: true });
  assert.ok(warnings.some((line) => line.includes("kota")), warnings.join(" | "));
  assert.ok(warnings.some((line) => line.includes("bağlanılamadı")), warnings.join(" | "));
  assert.deepEqual(
    envelopeWarnings(
      { ...watch, connected: 60, failed: 0, rateLimited: false, rateLimitHits: 0 },
      { rooms: 60, apiKey: true },
    ),
    [],
  );
});

test("koin çantası işaretlenir, fan kulübü çantası reddedilir", () => {
  const bag = {
    baseInfo: {
      goodyBagId: "9001",
      biz: 1,
      coinDetail: { totalCoin: 1200 },
      commonDetail: { winnerHeadcount: 50 },
      roomId: "7300000000000000000",
    },
    openAt: now(),
  };
  const reward = bagReward(bag, "7300000000000000009");
  assert.equal(reward.envelopeId, "bag:9001");
  assert.equal(reward.coins, 1200);
  assert.equal(reward.slots, 50);
  assert.equal(bagReward({ ...bag, baseInfo: { ...bag.baseInfo, biz: 2 } }), null);
});
