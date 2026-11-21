import test from "node:test";
import assert from "node:assert/strict";
import { validateRoster, validateSnapshot } from "../scripts/radar-contract.mjs";

const snapshot = () => ({
  schema: 1,
  generatedAt: "2026-01-01T12:00:00.000Z",
  stats: { live: 1, chests: 1 },
  streams: [{ username: "a", roomId: "1", viewers: 10 }],
  chests: [{ envelopeId: "e1", username: "a", coins: 100, slots: 10, opensAt: "2026-01-01T12:05:00.000Z" }],
  errors: [],
});

test("geçerli anlık görüntü sözleşmeyi sağlar", () => {
  assert.deepEqual(validateSnapshot(snapshot()), []);
});

test("eksik kullanıcı adı yakalanır", () => {
  const data = snapshot();
  delete data.streams[0].username;
  const problems = validateSnapshot(data);
  assert.ok(problems.some((problem) => problem.includes("streams[0].username")), problems.join(" | "));
});

test("geçersiz sandık açılış zamanı yakalanır", () => {
  const data = snapshot();
  data.chests[0].opensAt = "yarın";
  const problems = validateSnapshot(data);
  assert.ok(problems.some((problem) => problem.includes("opensAt")), problems.join(" | "));
});

test("yanlış şema sürümü reddedilir", () => {
  const data = { ...snapshot(), schema: 2 };
  assert.ok(validateSnapshot(data).some((problem) => problem.includes("schema")));
});

test("watch ve uyarı alanları sözleşmede doğrulanır", () => {
  const data = {
    ...snapshot(),
    warnings: ["EULER_API_KEY yok: WebSocket imzalaması ücretsiz kotada."],
    watch: {
      requested: 60,
      connected: 12,
      failed: 0,
      seconds: 300,
      envelopes: 1,
      rateLimited: false,
      rateLimitHits: 0,
      signedWithKey: false,
      messageTypes: { WebcastEnvelopeMessage: 2 },
    },
  };
  assert.deepEqual(validateSnapshot(data), []);
  assert.ok(validateSnapshot({ ...data, warnings: "uyarı" }).some((problem) => problem.includes("warnings")));
  assert.ok(
    validateSnapshot({ ...data, watch: { ...data.watch, signedWithKey: "hayır" } }).some((problem) =>
      problem.includes("watch.signedWithKey"),
    ),
  );
  assert.ok(
    validateSnapshot({ ...data, watch: { ...data.watch, connected: undefined } }).some((problem) =>
      problem.includes("watch.connected"),
    ),
  );
});

test("üye defteri biçimi doğrulanır", () => {
  const valid = {
    schema: 1,
    updatedAt: "2026-01-01T12:00:00.000Z",
    total: 2,
    days: [{ date: "2026-01-01", added: 2, total: 2 }],
    streamers: [{ username: "a" }, { username: "b" }],
  };
  assert.deepEqual(validateRoster(valid), []);
  assert.ok(validateRoster({ ...valid, days: {} }).some((problem) => problem.includes("days")));
  assert.ok(validateRoster({ ...valid, streamers: [{ nickname: "x" }] }).some((problem) => problem.includes("username")));
});
