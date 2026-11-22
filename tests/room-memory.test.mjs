import test from "node:test";
import assert from "node:assert/strict";
import { mergeRoomMemory, roomPriority } from "../scripts/room-memory.mjs";
import { shardRooms } from "../scripts/envelope-shards.mjs";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const ago = (days) => new Date(NOW - days * 86_400_000).toISOString();

test("oda hafızası sayaçları toplar, tarihleri tazeler ve eski kaydı budar", () => {
  const merged = mergeRoomMemory(
    {
      "730000000000000001": {
        attempts: 3,
        connected: 2,
        rateLimitHits: 1,
        envelopes: 1,
        lastAttemptAt: ago(50),
      },
      "730000000000000002": {
        attempts: 9,
        connected: 9,
        envelopes: 4,
        lastAttemptAt: ago(60),
      },
    },
    {
      "730000000000000001": {
        attempts: 2,
        connected: 2,
        envelopes: 3,
        lastConnectedAt: ago(1),
        lastEnvelopeAt: ago(1),
      },
    },
    { now: NOW },
  );

  assert.deepEqual(Object.keys(merged), ["730000000000000001"]);
  assert.equal(merged["730000000000000001"].attempts, 5);
  assert.equal(merged["730000000000000001"].connected, 4);
  assert.equal(merged["730000000000000001"].rateLimitHits, 1);
  assert.equal(merged["730000000000000001"].envelopes, 4);
  assert.equal(merged["730000000000000001"].lastAttemptAt, ago(50));
  assert.equal(merged["730000000000000001"].lastEnvelopeAt, ago(1));
});

test("oda önceliği getirili ve güvenilir odayı öne alır, 429'u cezalandırır", () => {
  const good = roomPriority(
    { attempts: 4, connected: 4, envelopes: 3, lastAttemptAt: ago(1) },
    NOW,
  );
  const empty = roomPriority({}, NOW);
  const noEnvelope = roomPriority(
    { attempts: 4, connected: 4, lastAttemptAt: ago(1) },
    NOW,
  );
  const limited = roomPriority(
    { attempts: 4, connected: 1, rateLimitHits: 3, lastAttemptAt: ago(1) },
    NOW,
  );

  assert.ok(good > empty, `${good} > ${empty}`);
  assert.ok(empty > noEnvelope, `${empty} > ${noEnvelope}`);
  assert.equal(limited, 0);
});

test("hafıza sıralaması eşit puanda giriş sırasını korur", () => {
  const rows = [
    { roomId: "730000000000000001", username: "ilk" },
    { roomId: "730000000000000002", username: "ikinci" },
  ];
  const selected = shardRooms(rows, {
    shard: 0,
    shards: 1,
    rooms: 2,
    memory: { "730000000000000001": {}, "730000000000000002": {} },
    now: NOW,
  });
  assert.deepEqual(selected.map((row) => row.username), ["ilk", "ikinci"]);
});
