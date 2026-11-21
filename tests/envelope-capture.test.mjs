import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createEnvelopeCapture, maskEnvelopePayload, writeEnvelopeFixture } from "../scripts/envelope-capture.mjs";
import { envelopeReward, watchEnvelopes } from "../scripts/envelope-watch.mjs";

const capturedAt = new Date("2026-11-21T22:00:00.000Z");
const rawFrame = () => ({
  common: {
    method: "WebcastEnvelopeMessage",
    msgId: "1234567890123456789",
    roomId: "2234567890123456789",
    displayText: "gizli kullanıcı metni",
  },
  envelopeInfo: {
    envelopeId: "3234567890123456789",
    roomId: "2234567890123456789",
    sendUserId: "4234567890123456789",
    sendUserName: "gercek_kullanici",
    sendUserAvatar: { urlList: ["https://example.com/avatar.jpg"] },
    diamondCount: 77,
    peopleCount: 9,
    unpackAt: Math.floor(Date.now() / 1000) + 120,
    businessType: 1,
    skinId: 0,
  },
  user: { id: "5234567890123456789", nickname: "gercek_kullanici" },
  url: "https://example.com/profile",
});

test("ham kare maskelenir, sayısal alanlar korunur", () => {
  const fixture = maskEnvelopePayload(rawFrame(), { capturedAt });
  const text = JSON.stringify(fixture);
  for (const secret of ["1234567890123456789", "2234567890123456789", "3234567890123456789", "4234567890123456789", "5234567890123456789", "gercek_kullanici", "avatar.jpg", "example.com"]) {
    assert.ok(!text.includes(secret), `maskelenmedi: ${secret}`);
  }
  assert.equal(fixture.fixture, "webcast-envelope-message");
  assert.equal(fixture.source.capturedFrom, "ArenaSag radar canlı WebSocket");
  assert.equal(fixture.payload.common.method, "WebcastEnvelopeMessage");
  assert.equal(fixture.payload.envelopeInfo.diamondCount, 77);
  assert.equal(fixture.payload.envelopeInfo.peopleCount, 9);
  assert.ok(fixture.payload.envelopeInfo.unpackAt > Math.floor(Date.now() / 1000));
  assert.equal(fixture.payload.envelopeInfo.sendUserAvatar.urlList.length, 0);
});

test("maskeli kare replay parser'ından geçer", () => {
  const fixture = maskEnvelopePayload(rawFrame(), { capturedAt });
  const reward = envelopeReward(fixture.payload, "2234567890123456789");
  assert.ok(reward);
  assert.equal(reward.coins, 77);
  assert.equal(reward.slots, 9);
  assert.equal(reward.roomId, "7000000000000000002");
});

test("yakalama adımı dosyayı bir kez yazar", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "arena-capture-"));
  const file = path.join(dir, "webcast-envelope-message.json");
  const capture = createEnvelopeCapture(file);
  const first = await capture(rawFrame());
  const second = await capture({ ...rawFrame(), envelopeInfo: { ...rawFrame().envelopeInfo, diamondCount: 99 } });
  assert.equal(first.payload.envelopeInfo.diamondCount, 77);
  assert.equal(second, null);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.payload.envelopeInfo.diamondCount, 77);
});

test("dinleyici ham kareyi yakalama adımına verir", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "arena-capture-"));
  const file = path.join(dir, "live.json");
  class FakeConnection {
    constructor() {
      this.handlers = {};
      this.roomInfo = {};
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    async connect() {
      this.handlers.envelope?.(rawFrame());
      return { isConnected: true };
    }
    async fetchRoomInfo() {
      return {};
    }
    async disconnect() {}
  }
  const watch = await watchEnvelopes({
    rooms: [{ roomId: "730000000000001001", username: "canli" }],
    seconds: 1,
    concurrency: 1,
    holdSeconds: 0.02,
    onRawEnvelope: createEnvelopeCapture(file),
    sdk: {
      TikTokLiveConnection: FakeConnection,
      WebcastEvent: { ENVELOPE: "envelope" },
      ControlEvent: { DECODED_DATA: "decodedData", ERROR: "error" },
    },
  });
  assert.equal(watch.connectedRooms, 1);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.equal(saved.payload.envelopeInfo.diamondCount, 77);
});

test("fixture yazımı hedef dizini oluşturur", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "arena-capture-"));
  const file = path.join(dir, "nested", "envelope.json");
  const fixture = await writeEnvelopeFixture(rawFrame(), file, { capturedAt });
  assert.equal(fixture.fixture, "webcast-envelope-message");
  assert.equal(JSON.parse(await readFile(file, "utf8")).payload.envelopeInfo.diamondCount, 77);
});
