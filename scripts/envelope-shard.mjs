#!/usr/bin/env node
/**
 * Matris zarf dinleyicisi — bir runner, kendi IP'si, kendi imzalama kotası.
 *
 * GitHub Actions matrisi 4 runner'ı paralel çalıştırır; her biri önceki yayındaki
 * canlı oda listesinden kendine düşen odaları dinler. Ücretsiz imzalama kotası
 * bağlantı sayısını sınırlar: 4 × 15 = 60 oda güvenli sınırdır ve kalan pencere
 * bağlı odada dinlemeye ayrılır. Anahtar varsa 4 × 30 = 120 oda tam pencere dinlenir.
 *
 * Odalar `--batch` büyüklüğünde turlara ayrılır, her tur kendi süresini dinler.
 * `--hold` isteğe bağlı bir üst sınırdır: 0 tüm turu dinler; pozitif değer
 * bağlantıyı erken kapatır ve kısa bağlantı ek oda bağlamadığı için üretimde
 * kullanılmaz. Ücretsiz kota aşılırsa dinleyici geri çekilir.
 *
 * Çıktı `arena-live.json` değildir: `envelope-shard-<n>.json` artifact'ıdır.
 * Git'e yazmaz, veritabanına dokunmaz; birleştirmeyi `radar-publish.mjs` yapar.
 *
 * Kullanım:
 *   node scripts/envelope-shard.mjs --shard 1 --shards 4 --rooms 15 --batch 5 \
 *     --seconds 300 --hold 0 --from web/data/arena-live.json
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { watchEnvelopes } from "./envelope-watch.mjs";
import { createEnvelopeNotifier } from "./radar-notify.mjs";
import { mergeShardWatches, shardRooms } from "./envelope-shards.mjs";

const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(value)));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** `--ad` biçimindeki argümanı, yoksa ortam değişkenini, yoksa varsayılanı okur. */
function option(name, envName, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  const raw = index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : process.env[envName];
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function textOption(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const shard = clamp(option("shard", "ARENA_SHARD_INDEX", 0), 0, 11);
const shards = clamp(option("shards", "ARENA_SHARDS", 4), 1, 12);
const roomLimit = clamp(option("rooms", "ARENA_SHARD_ROOMS", 15), 1, 40);
const seconds = clamp(option("seconds", "ARENA_SHARD_SECONDS", 300), 30, 900);
const batchSize = clamp(option("batch", "ARENA_SHARD_BATCH", 5), 1, 10);
// 0: oda pencere sonuna kadar dinlenir (eski davranış).
const holdSeconds = clamp(option("hold", "ARENA_SHARD_HOLD", 0), 0, 300);
const from = textOption("from", "web/data/arena-live.json");
const out = textOption("out", path.join(path.dirname(from), `envelope-shard-${shard}.json`));
const apiKey = process.env.EULER_API_KEY || "";
const log = (line) => console.log(`[shard ${shard}/${shards}] ${line}`);

const snapshot = await readFile(from, "utf8")
  .then((text) => JSON.parse(text))
  .catch(() => null);
if (!snapshot) log(`uyarı: ${from} okunamadı; dinlenecek oda yok (birleştirme yine çalışır)`);
const rooms = shardRooms(snapshot?.streams, {
  shard,
  shards,
  rooms: roomLimit,
  // Önceki yayındaki oda başarı/429/zarf geçmişi bu turun sırasını belirler.
  memory: snapshot?.roomMemory,
});

// Önceki yayında bildirilmiş sandıklar tekrar bildirilmez; koşu başına sınır
// ve kanal seçimi radar-notify içinde.
const known = (Array.isArray(snapshot?.chests) ? snapshot.chests : [])
  .map((row) => String(row?.envelopeId ?? ""))
  .filter(Boolean);
const notifier = createEnvelopeNotifier({
  known,
  context: { requested: rooms.length, signedWithKey: Boolean(apiKey) },
  log,
});

const startedAt = Date.now();
const deadline = startedAt + seconds * 1000;
const batches = [];
for (let index = 0; index < rooms.length; index += batchSize) batches.push(rooms.slice(index, index + batchSize));

const parts = [];
for (const [index, batch] of batches.entries()) {
  const remaining = Math.round((deadline - Date.now()) / 1000);
  if (remaining < 15) {
    log(`süre doldu; ${batches.length - index} tur dinlenemedi`);
    break;
  }
  // Kalan süre turlara eşit dağıtılır ki son odalar da pencere görsün.
  const dwell = Math.min(remaining, Math.ceil(remaining / (batches.length - index)));
  log(`tur ${index + 1}/${batches.length}: ${batch.length} oda · ${dwell} sn`);
  const result = await watchEnvelopes({
    rooms: batch,
    seconds: dwell,
    // Tur zaten batch kadar; tüm odalara aynı anda bağlanılır.
    concurrency: batch.length,
    holdSeconds,
    apiKey,
    onEnvelope: (reward, room) => notifier.offer(reward, room),
    log,
  });
  parts.push({ watch: result });
  if (index < batches.length - 1) await sleep(1_200);
}

const empty = {
  requested: rooms.length,
  connected: 0,
  connectedRooms: 0,
  attempted: 0,
  roomHistory: {},
  unknownSamples: {},
  failed: 0,
  seconds: 0,
  rateLimited: false,
  rateLimitHits: 0,
  signedWithKey: Boolean(apiKey),
  cooldownUntil: null,
  cooldownSeconds: 0,
  cooldownWaits: 0,
  envelopes: [],
  messageTypes: {},
  errors: [],
};
const watch = mergeShardWatches(parts) ?? empty;
watch.seconds = Math.round((Date.now() - startedAt) / 1000);
const notified = await notifier.settle();

const payload = {
  schema: 1,
  shard,
  shards,
  generatedAt: new Date().toISOString(),
  commit: process.env.GITHUB_SHA || "",
  rooms,
  watch,
  // Bildirim teslimatı da artifact'a girer; scan sağlık/uyarı alanına taşır.
  notifications: notified,
};
await mkdir(path.dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(payload)}\n`, "utf8");

log(
  `${watch.connectedRooms}/${watch.requested} oda bağlandı · ${watch.connected} bağlantı / ${watch.attempted} deneme · ` +
    `${watch.envelopes.length} zarf · ${watch.rateLimitHits} kota reddi · ${notified.sent} bildirim · ${watch.seconds} sn → ${out}`,
);
if (!watch.connected) {
  log(
    rooms.length
      ? "uyarı: hiçbir odaya bağlanılamadı (kota/IP); boş sonuç yine birleştirmeye gider"
      : "uyarı: dinlenecek oda yok (önceki yayın boş ya da veri dalı yok)",
  );
}
