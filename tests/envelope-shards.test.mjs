import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { mergeShardWatches, readShardResults, shardRooms } from "../scripts/envelope-shards.mjs";

const streams = (count) =>
  Array.from({ length: count }, (_, index) => ({
    roomId: `73000000000000${String(index).padStart(5, "0")}`,
    username: `yayin${index}`,
    nickname: `Yayın ${index}`,
    viewers: 1000 - index,
    region: "TR",
  }));

const watch = (overrides = {}) => ({
  requested: 4,
  connected: 3,
  connectedRooms: 3,
  attempted: 4,
  failed: 1,
  seconds: 100,
  rateLimited: false,
  rateLimitHits: 0,
  signedWithKey: false,
  envelopes: [],
  messageTypes: { WebcastEnvelopeMessage: 1 },
  errors: [],
  ...overrides,
});

test("60 oda 4 shard'a üst üste binmeden dağıtılır", () => {
  const rows = streams(60);
  const slices = [0, 1, 2, 3].map((shard) => shardRooms(rows, { shard, shards: 4, rooms: 15 }));
  assert.deepEqual(
    slices.map((slice) => slice.length),
    [15, 15, 15, 15],
  );
  const ids = new Set(slices.flat().map((room) => room.roomId));
  assert.equal(ids.size, 60);
  // İzleyiciye göre ilk 60 oda dinlenir; dilimler sırayla paylaşılır.
  assert.equal(slices[0][0].username, "yayin0");
  assert.equal(slices[1][0].username, "yayin1");
});

test("bayat ve tekrarlı odalar ile @ işareti temizlenir", () => {
  const rows = [
    ...streams(6),
    { roomId: "7300000000000000006", username: "@Buyuk", stale: true },
    { roomId: "7300000000000000000", username: "tekrar" },
  ];
  const slice = shardRooms(rows, { shard: 0, shards: 1, rooms: 10 });
  assert.equal(slice.length, 6);
  assert.ok(!slice.some((room) => room.stale));
  assert.equal(new Set(slice.map((room) => room.roomId)).size, slice.length);
  const handle = shardRooms([{ roomId: "7300000000000000009", username: "@Denisa" }], { shard: 0, shards: 1, rooms: 1 });
  assert.equal(handle[0].username, "denisa");
});

test("shard sonuçları tek watch kaydında birleşir", () => {
  const merged = mergeShardWatches([
    { watch: watch({ envelopes: [{ envelopeId: "a", coins: 10 }] }) },
    {
      watch: watch({
        signedWithKey: true,
        seconds: 120,
        rateLimitHits: 2,
        messageTypes: { WebcastEnvelopeMessage: 3, WebcastChatMessage: 2 },
        envelopes: [{ envelopeId: "a", coins: 10 }, { envelopeId: "b", coins: 20 }],
      }),
    },
  ]);
  assert.equal(merged.requested, 8);
  assert.equal(merged.connected, 6);
  assert.equal(merged.connectedRooms, 6);
  assert.equal(merged.attempted, 8);
  assert.equal(merged.failed, 2);
  assert.equal(merged.seconds, 120);
  assert.equal(merged.rateLimitHits, 2);
  // Bir shard ücretsiz imzalıyorsa kota uyarısı görünmeli.
  assert.equal(merged.signedWithKey, false);
  assert.equal(merged.envelopes.length, 2);
  assert.equal(merged.messageTypes.WebcastEnvelopeMessage, 4);
  assert.equal(merged.messageTypes.WebcastChatMessage, 2);
  assert.equal(merged.shards, 2);
  assert.equal(mergeShardWatches([]), null);
});

test("kota beklemesi shard'lardan birleşir", () => {
  const merged = mergeShardWatches([
    { watch: watch({ cooldownUntil: "2026-01-01T12:00:35.000Z", cooldownSeconds: 35, cooldownWaits: 2 }) },
    { watch: watch({ cooldownUntil: "2026-01-01T12:01:00.000Z", cooldownSeconds: 20, cooldownWaits: 1 }) },
  ]);
  assert.equal(merged.cooldownWaits, 3);
  assert.equal(merged.cooldownSeconds, 35);
  assert.equal(merged.cooldownUntil, "2026-01-01T12:01:00.000Z");
  assert.equal(mergeShardWatches([{ watch: watch() }]).cooldownUntil, null);
});

test("artifact okuma bozuk dosyayı atlar", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "arena-shards-"));
  await writeFile(path.join(dir, "envelope-shard-1.json"), JSON.stringify({ schema: 1, shard: 1, watch: watch() }));
  await writeFile(path.join(dir, "envelope-shard-2.json"), "{bozuk");
  await writeFile(path.join(dir, "baska.json"), JSON.stringify({ schema: 1 }));
  const results = await readShardResults(dir);
  assert.equal(results.length, 1);
  assert.equal(results[0].shard, 1);
  assert.deepEqual(await readShardResults(path.join(dir, "yok")), []);
});
