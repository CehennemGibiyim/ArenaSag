#!/usr/bin/env node
/**
 * Matris zarf dinlemesinin ortak parçaları.
 *
 * GitHub Actions matrisi her runner'a ayrı bir IP ve ayrı ücretsiz imzalama
 * kotası verir. Bu modül üç işi tek yerde tanımlar:
 *
 *   - `shardRooms`: aynı canlı oda listesini shard'lara ayırır (üst üste binme yok),
 *   - `mergeShardWatches`: shard sonuçlarını tek `watch` kaydında birleştirir,
 *   - `readShardResults`: birleştirme işinin indirdiği artifact'ları okur.
 *
 * Böylece dinleyici (`envelope-shard.mjs`) ve birleştirici (`radar-publish.mjs`)
 * aynı bölüşüm/birleştirme kurallarını kullanır; ikisi sessizce ayrışamaz.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { mergeRoomMemory, roomPriority } from "./room-memory.mjs";

const list = (value) => (Array.isArray(value) ? value : []);
const obj = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});
const integer = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

/**
 * Canlı oda listesinden bu shard'a düşen dilimi seçer.
 *
 * Havuz, izleyiciye göre sıralı listenin ilk `rooms * shards` kaydıdır; kayıtlar
 * sırayla shard'lara dağıtılır. Ücretsiz kotada 4 × 15 = 60, anahtarlı modda
 * 4 × 30 = 120 oda dinlenir; aynı oda iki runner'da kota harcamaz.
 *
 * `memory` verilirse havuz önce oda başarı/zarf geçmişine göre sıralanır; eşit
 * puanda eski (izleyici) sıra korunur. Hafıza yoksa davranış tamamen eskisiyle
 * aynıdır.
 */
export function shardRooms(streams, { shard = 0, shards = 1, rooms = 0, memory = {}, now = Date.now() } = {}) {
  const total = Math.max(1, Math.round(Number(shards) || 1));
  const index = Math.min(total - 1, Math.max(0, Math.round(Number(shard) || 0)));
  const perShard = Math.max(0, Math.round(Number(rooms) || 0));
  const hasMemory = Object.keys(obj(memory)).length > 0;
  const pool = [];
  const seen = new Set();
  for (const row of list(streams)) {
    const roomId = String(obj(row).roomId ?? "").trim();
    if (!roomId || seen.has(roomId) || obj(row).stale === true) continue;
    seen.add(roomId);
    pool.push({ row, index: pool.length });
    if (!hasMemory && perShard > 0 && pool.length >= perShard * total) break;
  }
  let ranked = pool;
  if (hasMemory) {
    const scores = new Map(pool.map(({ row }) => [row.roomId, roomPriority(memory[row.roomId], now)]));
    ranked = pool.slice().sort((a, b) => {
      const score = scores.get(b.row.roomId) - scores.get(a.row.roomId);
      return score || a.index - b.index;
    });
  }
  return ranked
    .slice(0, perShard > 0 ? perShard * total : undefined)
    .filter((_, position) => position % total === index)
    .slice(0, perShard > 0 ? perShard : undefined)
    .map(({ row }) => ({
      roomId: String(row.roomId),
      username: String(row.username ?? "").replace(/^@+/, "").toLowerCase(),
      nickname: String(row.nickname ?? ""),
      title: String(row.title ?? ""),
      viewers: integer(row.viewers),
      region: String(row.region ?? ""),
      avatar: String(row.avatar ?? ""),
    }));
}

/**
 * Shard sonuçlarını tek `watch` kaydında birleştirir.
 *
 * Sayaçlar toplanır, `seconds` en uzun pencereyi alır, `signedWithKey` ancak tüm
 * shard'lar anahtarlıysa true olur (biri ücretsizse kota uyarısı görünmeli),
 * `rateLimited` herhangi biri için true ise true olur ve zarflar kimliğe göre
 * tekilleştirilir.
 */
export function mergeShardWatches(results) {
  const rows = list(results);
  if (!rows.length) return null;
  const envelopes = new Map();
  const messageTypes = {};
  const errors = [];
  const merged = {
    requested: 0,
    connected: 0,
    connectedRooms: 0,
    attempted: 0,
    roomInfoEnvelopeRooms: 0,
    roomHistory: {},
    unknownSamples: {},
    failed: 0,
    seconds: 0,
    rateLimited: false,
    rateLimitHits: 0,
    signedWithKey: true,
    cooldownUntil: null,
    cooldownSeconds: 0,
    cooldownWaits: 0,
    envelopes: [],
    messageTypes,
    errors,
  };
  const cooldownUntilMs = [];
  for (const row of rows) {
    const watch = obj(obj(row).watch);
    merged.roomHistory = mergeRoomMemory(merged.roomHistory, watch.roomHistory, {
      now: Date.now(),
      maxAgeMs: Number.POSITIVE_INFINITY,
      limit: 10_000,
    });
    for (const [type, sample] of Object.entries(obj(watch.unknownSamples))) {
      if (type && !merged.unknownSamples[type] && obj(sample).sample) merged.unknownSamples[type] = sample;
    }
    merged.requested += integer(watch.requested);
    merged.connected += integer(watch.connected);
    merged.connectedRooms += integer(watch.connectedRooms);
    merged.attempted += integer(watch.attempted);
    merged.roomInfoEnvelopeRooms += integer(watch.roomInfoEnvelopeRooms);
    merged.failed += integer(watch.failed);
    merged.seconds = Math.max(merged.seconds, integer(watch.seconds));
    merged.rateLimited = merged.rateLimited || watch.rateLimited === true;
    merged.rateLimitHits += integer(watch.rateLimitHits);
    merged.signedWithKey = merged.signedWithKey && watch.signedWithKey === true;
    merged.cooldownWaits += integer(watch.cooldownWaits);
    merged.cooldownSeconds = Math.max(merged.cooldownSeconds, integer(watch.cooldownSeconds));
    const cooldownMs = Date.parse(String(watch.cooldownUntil ?? ""));
    if (Number.isFinite(cooldownMs)) cooldownUntilMs.push(cooldownMs);
    for (const [type, count] of Object.entries(obj(watch.messageTypes))) {
      messageTypes[type] = (messageTypes[type] || 0) + integer(count);
    }
    for (const reward of list(watch.envelopes)) {
      const envelopeId = String(obj(reward).envelopeId ?? "");
      if (envelopeId && !envelopes.has(envelopeId)) envelopes.set(envelopeId, reward);
    }
    for (const error of list(watch.errors)) {
      if (errors.length < 20) errors.push(String(error));
    }
  }
  merged.envelopes = [...envelopes.values()];
  // Panel geri sayımı en geç biten bekleme penceresini gösterir.
  if (cooldownUntilMs.length) {
    merged.cooldownUntil = new Date(Math.max(...cooldownUntilMs)).toISOString();
  }
  merged.shards = rows.length;
  return merged;
}

/** Her shard artifact'ından kapsam sayaçlarını çıkarır; birleşik watch'a eklenir. */
export function shardCoverage(results) {
  return list(results).map((row) => {
    const watch = obj(obj(row).watch);
    return {
      shard: integer(obj(row).shard),
      attempted: integer(watch.attempted),
      connectedRooms: integer(watch.connectedRooms),
      roomInfoEnvelopeRooms: integer(watch.roomInfoEnvelopeRooms),
    };
  });
}

/**
 * Birleştirme işinin indirdiği `envelope-shard-*.json` dosyalarını okur.
 * Bozuk veya şeması tanınmayan dosya birleştirmeyi düşürmez, atlanır.
 */
export async function readShardResults(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = entries
    .filter((entry) => entry.isFile() && /^envelope-shard-.*\.json$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const results = [];
  for (const name of files) {
    try {
      const payload = JSON.parse(await readFile(path.join(dir, name), "utf8"));
      if (obj(payload).schema !== 1) continue;
      results.push(payload);
    } catch {
      // Bir shard'ın bozuk artifact'ı diğerlerinin birleşmesini engellemez.
    }
  }
  return results;
}
