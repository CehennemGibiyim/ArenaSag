import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { envelopeReward } from "../scripts/envelope-watch.mjs";
import { applyChestReward, BUSINESS_LABELS, variantOf } from "../scripts/chest-record.mjs";

// Gerçek TikTok Webcast karesinden alınmış, kimlikleri maskelenmiş fixture.
// Kaynak ve maskeleme listesi dosyanın `source` alanında; ağa çıkmadan çalışır.
const fixture = JSON.parse(await readFile(new URL("./fixtures/webcast-envelope-message.json", import.meta.url), "utf8"));
// Sabit tarih, parser'ın 6 saatlik tazelik penceresini bir süre sonra aşıyordu;
// fixture'ı gerçek "şimdi"ye taşıyarak testi zamandan bağımsız tut.
const NOW = Date.now();
// Beklentiler fixture'ın kendisinden türetilir: yeni bir canlı kareyle
// değiştirildiğinde test koin/kişi/kimlik değerlerine takılmaz.
const envelope = fixture.payload.envelopeInfo;
const fixtureRoomId = String(envelope.roomId ?? fixture.payload.common?.roomId ?? "");
const stream = {
  username: "ornek_yayinci",
  nickname: "Örnek Yayıncı",
  title: "canlı yayın",
  roomId: fixtureRoomId,
  viewers: 1200,
};

/** Gerçek kareyi olduğu gibi kullanır; yalnızca açılış zamanını test saatine taşır. */
function payloadAt(now) {
  const payload = structuredClone(fixture.payload);
  payload.envelopeInfo.unpackAt = Math.floor(now / 1000) + 120;
  return payload;
}

test("fixture gerçek bir WebcastEnvelopeMessage karesi", () => {
  assert.equal(fixture.fixture, "webcast-envelope-message");
  assert.equal(fixture.source.method, "WebcastEnvelopeMessage");
  assert.equal(fixture.payload.common.method, "WebcastEnvelopeMessage");
  assert.ok(Number(fixture.payload.envelopeInfo.businessType) > 0);
  // Maskeleme: kimlikler taklit, sayısal alanlar gerçek.
  assert.ok(fixture.payload.envelopeInfo.envelopeId);
  assert.ok(fixture.payload.envelopeInfo.diamondCount > 0);
  assert.ok(fixture.payload.envelopeInfo.peopleCount > 0);
});

test("replay: gerçek zarf karesi sandık kaydına dönüşür", () => {
  const payload = payloadAt(NOW);
  const reward = envelopeReward(payload, stream.roomId);

  // 1) Parser gerçek kareyi olduğu gibi okur.
  assert.ok(reward, "gerçek kare zarf ödülüne çevrilemedi");
  assert.equal(reward.envelopeId, String(envelope.envelopeId));
  assert.equal(reward.roomId, fixtureRoomId);
  assert.equal(reward.coins, Number(envelope.diamondCount));
  assert.equal(reward.slots, Number(envelope.peopleCount));
  assert.equal(reward.businessType, Number(envelope.businessType ?? 1));
  assert.equal(reward.skinId, Number(envelope.skinId) || 1);
  assert.equal(reward.container, "ws");
  assert.equal(reward.opensAt, Math.floor(NOW / 1000) + 120);

  // 2) Aynı koşuda sandık kaydına yazılır.
  const chests = new Map();
  const applied = applyChestReward(chests, reward, stream, { now: NOW });
  assert.ok(applied?.isNew);
  assert.equal(chests.size, 1);

  const row = applied.row;
  const expected = variantOf(reward.skinId, reward.container);
  assert.equal(row.envelopeId, String(envelope.envelopeId));
  assert.equal(row.kind, expected.kind);
  assert.equal(row.variant, expected.variant);
  assert.equal(row.businessLabel, BUSINESS_LABELS[reward.businessType] ?? "coins");
  assert.deepEqual(row.labels, ["ws"]);
  assert.equal(row.username, "ornek_yayinci");
  assert.equal(row.nickname, "Örnek Yayıncı");
  assert.equal(row.roomId, fixtureRoomId);
  assert.equal(row.coins, Number(envelope.diamondCount));
  assert.equal(row.slots, Number(envelope.peopleCount));
  assert.equal(row.ratio, Math.round((Number(envelope.diamondCount) / Number(envelope.peopleCount)) * 100) / 100);
  assert.equal(row.viewers, 1200);
  assert.equal(row.opensAt, new Date((Math.floor(NOW / 1000) + 120) * 1000).toISOString());
  assert.equal(row.status, "waiting");
  assert.equal(row.seenCount, 1);
  assert.equal(row.detectedAt, new Date(NOW).toISOString());
  assert.equal(row.openUrl, "https://www.tiktok.com/@ornek_yayinci/live");
  assert.equal(row.deepLink, "snssdk1233://live?room_id=7000000000000000002");
});

test("aynı kare ikinci kez görülünce kayıt güncellenir, yenisi eklenmez", () => {
  const chests = new Map();
  const reward = envelopeReward(payloadAt(NOW), stream.roomId);
  applyChestReward(chests, reward, stream, { now: NOW });
  const later = NOW + 30_000;
  const again = applyChestReward(chests, reward, stream, { now: later });

  assert.ok(again);
  assert.equal(again.isNew, false);
  assert.equal(chests.size, 1);
  assert.equal(again.row.seenCount, 2);
  assert.equal(again.row.detectedAt, new Date(NOW).toISOString());
  assert.equal(again.row.lastSeenAt, new Date(later).toISOString());
});

test("odası eşleşmeyen zarf sandık listesine yazılmaz", () => {
  const reward = envelopeReward(payloadAt(NOW), stream.roomId);
  const chests = new Map();
  const applied = applyChestReward(chests, reward, { ...stream, roomId: "7000000000000000009" }, { now: NOW });
  assert.equal(applied, null);
  assert.equal(chests.size, 0);
});
