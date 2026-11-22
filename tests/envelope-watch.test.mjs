import test from "node:test";
import assert from "node:assert/strict";
import {
  bagReward,
  connectionHoldMs,
  envelopeSchemaState,
  envelopeTypeDrift,
  envelopeWarnings,
  envelopeReward,
  roomEnvelopeRewards,
  watchEnvelopes,
} from "../scripts/envelope-watch.mjs";

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

test("şema takibi tip başına son görülme ve kadansı yayınlar arasında taşır", () => {
  const now = Date.parse("2026-01-02T12:00:00.000Z");
  const previous = {
    envelopeTrackingSince: new Date(now - 30 * 3_600_000).toISOString(),
    envelopeLastSeenAt: new Date(now - 25 * 3_600_000).toISOString(),
    envelopeSampleType: "WebcastEnvelopeMessage",
  };
  const quiet = envelopeSchemaState({ WebcastChatMessage: 50 }, previous, now);
  assert.equal(quiet.trackingSince, previous.envelopeTrackingSince);
  assert.equal(quiet.lastSeenAt, previous.envelopeLastSeenAt);
  assert.equal(quiet.sampleType, "WebcastEnvelopeMessage");
  assert.equal(quiet.unknown.length, 0);
  assert.equal(quiet.typeActivity.WebcastEnvelopeMessage.lastSeenAt, previous.envelopeLastSeenAt);

  const seen = envelopeSchemaState({ WebcastEnvelopeMessageV2: 1 }, previous, now);
  assert.equal(seen.lastSeenAt, new Date(now).toISOString());
  assert.equal(seen.sampleType, "WebcastEnvelopeMessageV2");
  assert.deepEqual(seen.unknown.map((row) => row.type), ["WebcastEnvelopeMessageV2"]);
  assert.equal(seen.typeActivity.WebcastEnvelopeMessage.lastSeenAt, previous.envelopeLastSeenAt);
  assert.equal(seen.typeActivity.WebcastEnvelopeMessageV2.lastSeenAt, new Date(now).toISOString());

  const first = envelopeSchemaState({}, {}, now);
  assert.equal(first.trackingSince, new Date(now).toISOString());
  assert.equal(first.lastSeenAt, null);
  assert.equal(first.sampleType, null);
  assert.deepEqual(first.typeActivity, {});
});

test("ardışık turlar tipin görülme kadansını öğrenir", () => {
  const now = Date.parse("2026-01-02T12:00:00.000Z");
  const first = envelopeSchemaState({ WebcastEnvelopeMessage: 1 }, {}, now - 10 * 60_000);
  const second = envelopeSchemaState(
    { WebcastEnvelopeMessage: 2 },
    { envelopeTrackingSince: first.trackingSince, envelopeTypeActivity: first.typeActivity },
    now,
  );
  assert.equal(second.typeActivity.WebcastEnvelopeMessage.meanGapMs, 10 * 60_000);
  assert.equal(second.typeActivity.WebcastEnvelopeMessage.gapCount, 1);
  assert.equal(second.typeActivity.WebcastEnvelopeMessage.thresholdMs, 30 * 60_000);
  assert.equal(second.typeActivity.WebcastEnvelopeMessage.seenRuns, 2);
});

test("şema durumu sessiz tipi kadans eşiği ve akan diğer tiple işaretler", () => {
  const now = Date.parse("2026-01-02T12:00:00.000Z");
  const state = envelopeSchemaState(
    { WebcastGoodyBagMessage: 2 },
    {
      envelopeTrackingSince: new Date(now - 2 * 3_600_000).toISOString(),
      envelopeTypeActivity: {
        WebcastEnvelopeMessage: {
          lastSeenAt: new Date(now - 40 * 60_000).toISOString(),
          firstSeenAt: new Date(now - 2 * 3_600_000).toISOString(),
          meanGapMs: 10 * 60_000,
          gapCount: 5,
          seenRuns: 6,
        },
      },
    },
    now,
  );
  assert.equal(state.typeActivity.WebcastEnvelopeMessage.thresholdMs, 30 * 60_000);
  assert.equal(state.typeActivity.WebcastEnvelopeMessage.silent, true);
  assert.equal(state.typeActivity.WebcastEnvelopeMessage.silentWhileOtherFlows, true);
  assert.deepEqual(state.silentWhileOtherFlows, ["WebcastEnvelopeMessage"]);
  assert.deepEqual(state.flowingTypes, ["WebcastGoodyBagMessage"]);
});

test("tip sessizliği gözlenen kadansa göre uyarlanır, akan diğer tip işaretlenir", () => {
  const now = Date.parse("2026-01-02T12:00:00.000Z");
  const activity = {
    WebcastEnvelopeMessage: {
      lastSeenAt: new Date(now - 40 * 60_000).toISOString(),
      meanGapMs: 10 * 60_000,
      gapCount: 5,
    },
    WebcastGoodyBagMessage: {
      lastSeenAt: new Date(now - 2 * 60_000).toISOString(),
      meanGapMs: 10 * 60_000,
      gapCount: 5,
    },
  };
  const warnings = envelopeWarnings(
    baseWatch({ messageTypes: { WebcastGoodyBagMessage: 1 } }),
    { rooms: 60, typeActivity: activity, flowingTypes: ["WebcastGoodyBagMessage"], now },
  );
  const silence = warnings.find((line) => line.includes("Zarf tipi sessiz: WebcastEnvelopeMessage"));
  assert.ok(silence, warnings.join(" | "));
  assert.match(silence, /son görülme 2026-01-02 11:20 UTC/);
  assert.match(silence, /eşik 30 dk/);
  assert.match(silence, /Başka zarf tipi akıyor: WebcastGoodyBagMessage/);

  // Seyrek tip: 6 saatte bir görülüyorsa 7 saatlik boşluk erken alarm değildir.
  const sparse = envelopeWarnings(
    baseWatch({ messageTypes: { WebcastGoodyBagMessage: 1 } }),
    {
      rooms: 60,
      typeActivity: {
        WebcastEnvelopeMessage: {
          lastSeenAt: new Date(now - 7 * 3_600_000).toISOString(),
          meanGapMs: 6 * 3_600_000,
          gapCount: 4,
        },
      },
      flowingTypes: ["WebcastGoodyBagMessage"],
      now,
    },
  );
  assert.equal(sparse.length, 0, sparse.join(" | "));
});

test("hiç kadans yoksa taban sessizlik uyarısı görünür kalır", () => {
  const now = Date.parse("2026-01-02T12:00:00.000Z");
  const warnings = envelopeWarnings(baseWatch(), {
    rooms: 60,
    trackingSince: new Date(now - 25 * 3_600_000).toISOString(),
    now,
  });
  assert.ok(warnings.some((line) => line.includes("Zarf tipi sessiz") && line.includes("taban 24 saat")), warnings.join(" | "));
});

const baseWatch = (patch = {}) => ({
  requested: 60,
  connected: 12,
  failed: 0,
  seconds: 300,
  envelopes: [],
  rateLimited: false,
  rateLimitHits: 0,
  signedWithKey: true,
  messageTypes: {},
  ...patch,
});

test("bilinen zarf tipleri ayrılır, yeni tip şema sürüklenmesi sayılır", () => {
  const drift = envelopeTypeDrift({
    WebcastEnvelopeMessage: 12,
    WebcastEnvelopeMessageV2: 3,
    WebcastGoodyBagMessage: 2,
    WebcastChatMessage: 900,
  });
  assert.deepEqual(drift.types, ["WebcastEnvelopeMessage", "WebcastEnvelopeMessageV2", "WebcastGoodyBagMessage"]);
  assert.deepEqual(drift.unknown.map((row) => row.type), ["WebcastEnvelopeMessageV2"]);
  assert.equal(drift.sampleType, "WebcastEnvelopeMessage");
  assert.deepEqual(envelopeTypeDrift({ WebcastChatMessage: 5 }), { types: [], sampleType: null, unknown: [] });
});

test("kota beklemesi uyarıda görünür", () => {
  const warnings = envelopeWarnings(
    baseWatch({ rateLimitHits: 2, cooldownWaits: 2, cooldownSeconds: 35, cooldownUntil: new Date().toISOString() }),
    { rooms: 60, seconds: 300 },
  );
  assert.ok(
    warnings.some((line) => line.includes("2 kez 35 sn beklenip yeniden denendi")),
    warnings.join(" | "),
  );
});

test("yeni zarf tipi örnek tipiyle uyarı üretir", () => {
  const warnings = envelopeWarnings(
    baseWatch({ messageTypes: { WebcastEnvelopeMessage: 2, WebcastEnvelopeMessageV2: 4, WebcastLikeMessage: 200 } }),
    { rooms: 60, seconds: 300 },
  );
  const drift = warnings.find((line) => line.includes("Zarf şeması sürüklenmesi"));
  assert.ok(drift, warnings.join(" | "));
  assert.ok(drift.includes("WebcastEnvelopeMessageV2"), drift);
  assert.ok(drift.includes("Örnek: WebcastEnvelopeMessageV2"), drift);

  const withFields = envelopeWarnings(
    baseWatch({
      messageTypes: { WebcastEnvelopeMessageV2: 1 },
      unknownSamples: {
        WebcastEnvelopeMessageV2: { fields: ["envelopeInfo.yeniAlan", "common.method"] },
      },
    }),
    { rooms: 60, seconds: 300 },
  );
  assert.ok(withFields.some((line) => line.includes("Örnek alanlar: envelopeInfo.yeniAlan, common.method")));
});



test("kısa bağlantı süresi pencereyi aşmadan sınırlanır", () => {
  const now = 1_000_000;
  assert.equal(connectionHoldMs(now + 10_000, 0, now), 10_000);
  assert.equal(connectionHoldMs(now + 100_000, 30, now), 30_000);
  // Kalan pencere hold'dan kısaysa bağlantı pencereden taşmaz.
  assert.equal(connectionHoldMs(now + 10_000, 30, now), 10_000);
  assert.equal(connectionHoldMs(now - 1, 30, now), 0);
});

test("bağlantı anındaki oda verisindeki zarflar okunur", () => {
  const first = message().envelopeInfo;
  const second = { envelopeId: "7300000000000000002", diamondCount: 100, peopleCount: 5, unpackAt: now(), skinId: 1 };
  const stale = { envelopeId: "7300000000000000003", diamondCount: 50, peopleCount: 5, unpackAt: Math.floor(Date.now() / 1000) - 86_400 };
  const rewards = roomEnvelopeRewards(
    {
      data: {
        envelopeInfo: first,
        envelopeList: [second, first, stale],
        letterInfo: { envelopeId: "55", diamondCount: 30, peopleCount: 5, unpackAt: now() },
        goodyBag: {
          baseInfo: {
            goodyBagId: "9001",
            biz: 1,
            coinDetail: { totalCoin: 1200 },
            commonDetail: { winnerHeadcount: 50 },
          },
          openAt: now(),
        },
      },
    },
    "7300000000000000009",
  );
  assert.deepEqual(
    rewards.map((row) => row.envelopeId).sort(),
    ["7300000000000000001", "7300000000000000002", "bag:9001", "letter:55"].sort(),
  );
  assert.equal(rewards.find((row) => row.envelopeId === "7300000000000000002").roomId, "7300000000000000009");
  assert.deepEqual(roomEnvelopeRewards({}, "7300000000000000009"), []);
});

// Aynı süre bütçesinde kaç odaya bağlanıldığını ölçer: bağlantı gecikmesi
// global sıra numarasıyla çarpıldığında 60 odanın sonu bütçeyi kaçırıyordu.
test("60 odada bağlantı aralığı işçi başına sayılır, bütçe içinde tüm odalara girilir", async () => {
  const rooms = Array.from({ length: 60 }, (_, index) => ({
    roomId: `73000000000000${String(1000 + index)}`,
    username: `olcum${index}`,
  }));
  const connectMs = 5;
  class FakeConnection {
    constructor() {
      this.roomInfo = {};
    }
    on() {}
    async connect() {
      await new Promise((resolve) => setTimeout(resolve, connectMs));
      return { isConnected: true };
    }
    async fetchRoomInfo() {
      return {};
    }
    async disconnect() {}
  }
  const sdk = {
    TikTokLiveConnection: FakeConnection,
    WebcastEvent: { ENVELOPE: "envelope" },
    ControlEvent: { DECODED_DATA: "decodedData", ERROR: "error" },
  };
  const budgetMs = 1_200;
  const watch = await watchEnvelopes({
    rooms,
    seconds: budgetMs / 1000,
    concurrency: 12,
    connectGapMs: 40,
    holdSeconds: 0.02,
    sdk,
  });
  // Global sıra ile son oda 40ms * 59 = 2.360ms bekleyip bütçeyi aşıyordu;
  // işçi başına sıra ile her işçi (5 oda) en fazla 160ms bekler.
  assert.equal(watch.connectedRooms, rooms.length, JSON.stringify(watch.errors));
  assert.equal(watch.attempted, rooms.length);
  assert.equal(watch.connected, rooms.length);
});

test("ilk oda verisinden zarf çıkan oda sayılır", async () => {
  class FakeConnection {
    constructor() {
      this.roomInfo = message();
    }
    on() {}
    async connect() {
      return { isConnected: true };
    }
    async disconnect() {}
  }
  const watch = await watchEnvelopes({
    rooms: [{ roomId: "730000000000001001", username: "canli" }],
    seconds: 1,
    holdSeconds: 0.01,
    sdk: {
      TikTokLiveConnection: FakeConnection,
      WebcastEvent: { ENVELOPE: "envelope" },
      ControlEvent: { DECODED_DATA: "decodedData", ERROR: "error" },
    },
  });
  assert.equal(watch.roomInfoEnvelopeRooms, 1);
  assert.equal(watch.envelopes.length, 1);
});

test("oda geçmişi bağlantı ve zarf sayaçlarını biriktirir", async () => {
  const info = message();
  info.envelopeInfo.roomId = "730000000000001001";
  class FakeConnection {
    constructor() {
      this.roomInfo = info;
    }
    on() {}
    async connect() {
      return { isConnected: true };
    }
    async disconnect() {}
  }
  const watch = await watchEnvelopes({
    rooms: [{ roomId: "730000000000001001", username: "canli" }],
    seconds: 1,
    holdSeconds: 0.01,
    sdk: {
      TikTokLiveConnection: FakeConnection,
      WebcastEvent: { ENVELOPE: "envelope" },
      ControlEvent: { DECODED_DATA: "decodedData", ERROR: "error" },
    },
  });
  const history = watch.roomHistory["730000000000001001"];
  assert.equal(history.attempts, 1);
  assert.equal(history.connected, 1);
  assert.equal(history.envelopes, 1);
  assert.ok(history.lastAttemptAt);
  assert.ok(history.lastConnectedAt);
  assert.ok(history.lastEnvelopeAt);
});

test("bilinmeyen zarf tipinin maskeli örneği artifact için saklanır", async () => {
  const frame = {
    common: { method: "WebcastEnvelopeMessageV9", msgId: "gizli-mesaj" },
    envelopeInfo: {
      envelopeId: "gizli-zarf",
      sendUserName: "gizli-kullanici",
      diamondCount: 77,
      peopleCount: 9,
      unpackAt: now(),
      yeniAlan: "şema-örneği",
    },
  };
  class FakeConnection {
    constructor() {
      this.handlers = {};
      this.roomInfo = {};
    }
    on(event, handler) {
      this.handlers[event] = handler;
    }
    async connect() {
      this.handlers.decodedData?.("WebcastEnvelopeMessageV9", { data: frame });
      return { isConnected: true };
    }
    async disconnect() {}
  }
  const watch = await watchEnvelopes({
    rooms: [{ roomId: "730000000000001003", username: "canli" }],
    seconds: 1,
    holdSeconds: 0.01,
    sdk: {
      TikTokLiveConnection: FakeConnection,
      WebcastEvent: { ENVELOPE: "envelope" },
      ControlEvent: { DECODED_DATA: "decodedData", ERROR: "error" },
    },
  });
  const sample = watch.unknownSamples.WebcastEnvelopeMessageV9;
  assert.ok(sample);
  assert.ok(sample.fields.includes("envelopeInfo.yeniAlan"));
  assert.ok(sample.fields.includes("envelopeInfo.diamondCount"));
  const serialized = JSON.stringify(sample);
  assert.ok(!serialized.includes("gizli-mesaj"));
  assert.ok(!serialized.includes("gizli-zarf"));
  assert.ok(!serialized.includes("gizli-kullanici"));
  assert.equal(watch.messageTypes.WebcastEnvelopeMessageV9, 1);
});

test("429 alan odanın geçmişi güvenilirlik için işaretlenir", async () => {
  class FakeConnection {
    constructor() {}
    on() {}
    async connect() {
      throw new Error("429 Too Many Requests");
    }
    async disconnect() {}
  }
  const watch = await watchEnvelopes({
    rooms: [{ roomId: "730000000000001002", username: "kota" }],
    seconds: 1,
    apiKey: "test-key",
    sdk: {
      TikTokLiveConnection: FakeConnection,
      WebcastEvent: { ENVELOPE: "envelope" },
      ControlEvent: { DECODED_DATA: "decodedData", ERROR: "error" },
    },
  });
  const history = watch.roomHistory["730000000000001002"];
  assert.equal(history.attempts, 1);
  assert.equal(history.connected, 0);
  assert.equal(history.failed, 1);
  assert.equal(history.rateLimitHits, 1);
  assert.ok(history.lastRateLimitedAt);
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
