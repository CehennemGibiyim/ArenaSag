import test from "node:test";
import assert from "node:assert/strict";
import { bagReward, envelopeReward } from "../scripts/envelope-watch.mjs";

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
