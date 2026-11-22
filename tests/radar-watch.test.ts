import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { readGeneratedAt, readWarnings, readWatch } from "../src/lib/radar-watch";
import { readRadarWatch, syncRadar } from "../src/server/radar-sync";

const SNAPSHOT_URL = "https://example.test/web/data/arena-live.json";

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status });

async function withFetch(
  impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  run: () => Promise<void>,
) {
  const mocked = mock.method(globalThis, "fetch", impl);
  try {
    await run();
  } finally {
    mocked.mock.restore();
  }
}

test("eksik watch alanları sıfır ve boş değerlere indirgenir", () => {
  assert.equal(readWatch(null), null);
  assert.equal(readWatch("watch"), null);
  assert.equal(readWatch([]), null);
  assert.deepEqual(readWatch({}), {
    requested: 0,
    connected: 0,
    failed: 0,
    seconds: 0,
    envelopes: 0,
    rateLimited: false,
    rateLimitHits: 0,
    signedWithKey: false,
    cooldownUntil: null,
    cooldownSeconds: 0,
    cooldownWaits: 0,
    messageTypes: {},
  });
  assert.deepEqual(readWarnings(undefined), []);
  assert.deepEqual(readWarnings("uyarı"), []);
  assert.equal(readGeneratedAt(undefined), null);
});

test("bozuk tipler güvenli sayı ve bayraklara çevrilir", () => {
  const watch = readWatch({
    requested: "12",
    connected: "bağlı",
    failed: null,
    seconds: {},
    envelopes: [],
    rateLimitHits: "2",
    rateLimited: "true",
    signedWithKey: 1,
    cooldownUntil: "yarın",
    cooldownSeconds: "35",
    cooldownWaits: "x",
    messageTypes: ["WebcastEnvelopeMessage"],
  });
  assert.ok(watch);
  assert.equal(watch.requested, 12);
  assert.equal(watch.connected, 0);
  assert.equal(watch.failed, 0);
  assert.equal(watch.seconds, 0);
  assert.equal(watch.envelopes, 0);
  assert.equal(watch.rateLimitHits, 2);
  assert.equal(watch.rateLimited, false);
  assert.equal(watch.signedWithKey, false);
  assert.equal(watch.cooldownUntil, null);
  assert.equal(watch.cooldownSeconds, 35);
  assert.equal(watch.cooldownWaits, 0);
  assert.deepEqual(watch.messageTypes, {});
  assert.equal(readGeneratedAt("2026-01-01T12:00:00.000Z"), "2026-01-01T12:00:00.000Z");
  assert.equal(readGeneratedAt("bozuk"), null);
});

test("mesaj tipleri yalnızca pozitif sayıları taşır, sıfır/negatif elenir", () => {
  const watch = readWatch({
    messageTypes: {
      WebcastEnvelopeMessage: "3",
      WebcastGoodyBagMessage: 0,
      WebcastChatMessage: -5,
      WebcastLikeMessage: "çok",
    },
  });
  assert.deepEqual(watch?.messageTypes, { WebcastEnvelopeMessage: 3 });
});

test("uyarılar boş satırlardan arınır ve 5 satırda kesilir", () => {
  const warnings = readWarnings([
    "  birinci  ",
    "",
    null,
    5,
    "ikinci",
    "üçüncü",
    "dördüncü",
    "beşinci",
    "altıncı",
  ]);
  assert.deepEqual(warnings, ["birinci", "5", "ikinci", "üçüncü", "dördüncü"]);
});

test("radar-sync yayındaki watch/warnings/generatedAt alanlarını okur", async () => {
  await withFetch(
    async () =>
      jsonResponse({
        schema: 1,
        generatedAt: "2026-01-01T12:00:00.000Z",
        watch: {
          requested: 60,
          connected: 6,
          failed: 4,
          seconds: 300,
          envelopes: 0,
          rateLimited: false,
          rateLimitHits: 3,
          signedWithKey: false,
          cooldownUntil: "2026-01-01T12:00:30.000Z",
          cooldownSeconds: 35,
          cooldownWaits: 2,
          messageTypes: { WebcastChatMessage: 290 },
        },
        warnings: ["a", "b", "c", "d", "e", "f"],
      }),
    async () => {
      const state = await readRadarWatch(SNAPSHOT_URL);
      assert.equal(state.error, undefined);
      assert.equal(state.generatedAt, "2026-01-01T12:00:00.000Z");
      assert.equal(state.watch?.connected, 6);
      assert.equal(state.watch?.cooldownUntil, "2026-01-01T12:00:30.000Z");
      assert.equal(state.watch?.cooldownWaits, 2);
      assert.deepEqual(state.warnings, ["a", "b", "c", "d", "e"]);
    },
  );
});

test("başarılı watch yanıtı önbellekten okunur, ardışık sekmeler tek istek atar", async () => {
  const url = `${SNAPSHOT_URL}?cache=1`;
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return jsonResponse({ schema: 1, watch: { connected: 1 }, warnings: [] });
    },
    async () => {
      const first = await readRadarWatch(url);
      const second = await readRadarWatch(url);
      assert.equal(calls, 1);
      assert.equal(first.watch?.connected, 1);
      assert.equal(second.watch?.connected, 1);
    },
  );
});

test("60 saniyelik watch önbelleği süre dolunca düşer", async () => {
  const url = `${SNAPSHOT_URL}?ttl=60`;
  let calls = 0;
  let now = Date.parse("2026-01-01T12:00:00.000Z");
  const clock = mock.method(Date, "now", () => now);
  try {
    await withFetch(
      async () => {
        calls += 1;
        return jsonResponse({ schema: 1, watch: { connected: calls }, warnings: [] });
      },
      async () => {
        const first = await readRadarWatch(url);
        assert.equal(first.watch?.connected, 1);
        assert.equal(calls, 1);

        // Süre dolmadan önceki okuma önbellekten gelir.
        now += 59_999;
        const cached = await readRadarWatch(url);
        assert.equal(cached.watch?.connected, 1);
        assert.equal(calls, 1);

        // Tam 60 saniyede önbellek düşer ve yeniden GitHub'a gidilir.
        now += 1;
        const refreshed = await readRadarWatch(url);
        assert.equal(refreshed.watch?.connected, 2);
        assert.equal(calls, 2);
      },
    );
  } finally {
    clock.mock.restore();
  }
});

test("eşzamanlı watch istekleri tek upstream isteğini paylaşır", async () => {
  const url = `${SNAPSHOT_URL}?cache=2`;
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await withFetch(
    async () => {
      calls += 1;
      await gate;
      return jsonResponse({ schema: 1, watch: { connected: 2 }, warnings: [] });
    },
    async () => {
      const first = readRadarWatch(url);
      const second = readRadarWatch(url);
      release();
      const [a, b] = await Promise.all([first, second]);
      assert.equal(calls, 1);
      assert.equal(a.watch?.connected, 2);
      assert.equal(b.watch?.connected, 2);
    },
  );
});

test("hata önbelleğe alınmaz, sonraki istek yeniden dener", async () => {
  const url = `${SNAPSHOT_URL}?retry=1`;
  let calls = 0;
  await withFetch(
    async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ error: "yok" }, 503)
        : jsonResponse({ schema: 1, watch: { connected: 3 }, warnings: [] });
    },
    async () => {
      const first = await readRadarWatch(url);
      assert.equal(first.watch, null);
      const second = await readRadarWatch(url);
      assert.equal(second.watch?.connected, 3);
      assert.equal(calls, 2);
    },
  );
});

test("syncRadar paylaşılan fetchRadarPayload yolunu kullanır", async () => {
  const url = `${SNAPSHOT_URL}?sync=ok`;
  let calls = 0;
  let request: RequestInit | undefined;
  await withFetch(
    async (_input, init) => {
      calls += 1;
      request = init;
      return jsonResponse({
        schema: 1,
        generatedAt: "2026-01-01T12:00:00.000Z",
        streams: [],
        chests: [],
      });
    },
    async () => {
      const result = await syncRadar(url);
      assert.equal(calls, 1);
      assert.equal(result.ok, true);
      assert.equal(result.fetched, 0);
      assert.equal(result.rooms, 0);
      assert.equal(result.live, 0);
      assert.equal(result.chests, 0);
      assert.equal(result.stale, false);
      assert.match(result.syncedAt, /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(new Headers(request?.headers).get("user-agent"), "ArenaPanel/radar-sync");
      assert.equal(request?.cache, "no-store");
      assert.ok(request?.signal, "zaman aşımı sinyali gönderilmeli");
    },
  );
});

test("syncRadar hata sonucu döner ve hatalı biçimi kabul etmez", async () => {
  await withFetch(
    async () => jsonResponse({ error: "yok" }, 503),
    async () => {
      const result = await syncRadar(`${SNAPSHOT_URL}?sync=503`);
      assert.equal(result.ok, false);
      assert.equal(result.error, "HTTP 503");
      assert.equal(result.fetched, 0);
      assert.equal(result.rooms, 0);
      assert.equal(result.chests, 0);
    },
  );
  await withFetch(
    async () => jsonResponse({ schema: 1, chests: [] }),
    async () => {
      const result = await syncRadar(`${SNAPSHOT_URL}?sync=no-streams`);
      assert.equal(result.ok, false);
      assert.equal(result.fetched, 0);
      assert.ok(result.error?.includes("biçimi"), result.error);
    },
  );
});

test("radar-sync HTTP hatasında boş durum ve neden döner", async () => {
  await withFetch(
    async () => jsonResponse({ error: "yok" }, 503),
    async () => {
      const state = await readRadarWatch(`${SNAPSHOT_URL}?http=503`);
      assert.equal(state.watch, null);
      assert.deepEqual(state.warnings, []);
      assert.equal(state.generatedAt, null);
      assert.ok(state.error?.includes("HTTP 503"), state.error);
    },
  );
  await withFetch(
    async () => jsonResponse({ schema: 2 }),
    async () => {
      const state = await readRadarWatch(`${SNAPSHOT_URL}?schema=2`);
      assert.equal(state.watch, null);
      assert.equal(state.generatedAt, null);
      assert.ok(state.error?.includes("biçimi"), state.error);
    },
  );
  await withFetch(
    async () => {
      throw new Error("ağ yok");
    },
    async () => {
      const state = await readRadarWatch(`${SNAPSHOT_URL}?network=1`);
      assert.equal(state.watch, null);
      assert.deepEqual(state.warnings, []);
      assert.equal(state.error, "ağ yok");
    },
  );
});
