import test from "node:test";
import assert from "node:assert/strict";
import {
  createEnvelopeNotifier,
  envelopeMessage,
  mergeNotificationStats,
  notificationTarget,
  notificationTargets,
  notificationWarnings,
} from "../scripts/radar-notify.mjs";

const NOW = Date.parse("2026-11-21T20:00:00.000Z");
const reward = (envelopeId = "env-1") => ({
  envelopeId,
  roomId: "7300000000000000001",
  coins: 500,
  slots: 20,
  opensAt: Math.floor(NOW / 1000) + 300,
});

const meta = { username: "denisa", nickname: "Denisa", roomId: "7300000000000000001" };

function fakeFetch(response = { ok: true, status: 200, payload: { ok: true } }) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return {
      ok: response.ok,
      status: response.status,
      headers: { get: () => null },
      json: async () => response.payload,
    };
  };
  return { calls, fetchImpl };
}

function sequenceFetch(responses) {
  const calls = [];
  let position = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const response = responses[Math.min(position, responses.length - 1)];
    position += 1;
    return {
      ok: response.ok,
      status: response.status,
      headers: { get: () => null },
      json: async () => response.payload ?? {},
    };
  };
  return { calls, fetchImpl };
}

const discordEnv = { ARENA_DISCORD_WEBHOOK_URL: "https://discord.example/api/webhooks/abc/def" };
const telegramEnv = { ARENA_TELEGRAM_BOT_TOKEN: "gizli-token", ARENA_TELEGRAM_CHAT_ID: "42" };

test("kanal yalnızca ortamdan seçilir; iki kanal da listelenir", () => {
  assert.equal(notificationTarget({}), null);
  assert.equal(notificationTarget({ ARENA_TELEGRAM_BOT_TOKEN: "t" })?.channel, undefined);
  assert.equal(notificationTarget(telegramEnv)?.channel, "telegram");
  assert.equal(notificationTarget(discordEnv)?.channel, "discord");
  // Telegram önce gelir; Discord aynı anda yedek olarak korunur.
  assert.deepEqual(notificationTargets({ ...discordEnv, ...telegramEnv }).map((row) => row.channel), [
    "telegram",
    "discord",
  ]);
});

test("mesaj zarf bilgilerini düz metin taşır", () => {
  const message = envelopeMessage(reward(), meta, { now: NOW, requested: 60, signedWithKey: false });
  assert.match(message, /500 jeton \/ 20 kişi \(25 jeton\/kişi\)/);
  assert.match(message, /@denisa · Denisa/);
  assert.match(message, /20:05 UTC · 5 dk kaldı/);
  assert.match(message, /https:\/\/www\.tiktok\.com\/@denisa\/live/);
  assert.match(message, /WS 60 oda · ücretsiz imza/);
});

test("aynı zarf iki kez gönderilmez, önceki yayındaki zarf hiç gönderilmez", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const notifier = createEnvelopeNotifier({
    env: discordEnv,
    known: ["env-eski"],
    minGapMs: 0,
    now: () => NOW,
    fetchImpl,
  });
  assert.equal(notifier.offer(reward("env-eski"), meta), false);
  assert.equal(notifier.offer(reward(), meta), true);
  assert.equal(notifier.offer(reward(), meta), false);
  const stats = await notifier.settle();
  assert.equal(calls.length, 1);
  assert.equal(stats.sent, 1);
  // Biri önceki yayındaki kayıt, biri koşu içi tekrar: ikisi de atlandı sayılır.
  assert.equal(stats.skipped, 2);
});

test("koşu başına mesaj sınırı aşılmaz", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const notifier = createEnvelopeNotifier({ env: discordEnv, maxPerRun: 2, minGapMs: 0, now: () => NOW, fetchImpl });
  for (const id of ["a", "b", "c"]) notifier.offer(reward(id), meta);
  const stats = await notifier.settle();
  assert.equal(calls.length, 2);
  assert.equal(stats.sent, 2);
  assert.equal(stats.skipped, 1);
});

test("açılışı geçmiş zarf ve kanalsız ortam istek atmaz", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const expired = createEnvelopeNotifier({ env: discordEnv, minGapMs: 0, now: () => NOW + 600_000, fetchImpl });
  expired.offer(reward(), meta);
  await expired.settle();
  assert.equal(calls.length, 0);

  const logs = [];
  const silent = createEnvelopeNotifier({ env: {}, fetchImpl, log: (line) => logs.push(line) });
  assert.equal(silent.offer(reward(), meta), false);
  const stats = await silent.settle();
  assert.equal(calls.length, 0);
  assert.equal(stats.disabled, true);
  assert.ok(logs.some((line) => line.includes("tanımlı değil")), logs.join(" | "));
  assert.ok(notificationWarnings(stats).some((line) => line.includes("kapalı")));
});

test("geçici hata aynı kanalda yeniden denenir", async () => {
  const { calls, fetchImpl } = sequenceFetch([
    { ok: false, status: 500 },
    { ok: false, status: 429 },
    { ok: true, status: 200 },
  ]);
  const notifier = createEnvelopeNotifier({
    env: discordEnv,
    retryLimit: 2,
    retryDelayMs: 0,
    minGapMs: 0,
    now: () => NOW,
    fetchImpl,
  });
  notifier.offer(reward(), meta);
  const stats = await notifier.settle();
  assert.equal(calls.length, 3);
  assert.equal(stats.attempts, 3);
  assert.equal(stats.retries, 2);
  assert.equal(stats.sent, 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.channels.discord.failed, 2);
  assert.equal(stats.channels.discord.sent, 1);
});

test("Telegram tükenince Discord yedek kanalı kullanılır", async () => {
  const { calls, fetchImpl } = sequenceFetch([
    { ok: false, status: 500 },
    { ok: false, status: 500 },
    { ok: true, status: 200 },
  ]);
  const notifier = createEnvelopeNotifier({
    env: { ...telegramEnv, ...discordEnv },
    retryLimit: 1,
    retryDelayMs: 0,
    minGapMs: 0,
    now: () => NOW,
    fetchImpl,
  });
  notifier.offer(reward(), meta);
  const stats = await notifier.settle();
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /api\.telegram\.org/);
  assert.match(calls[2].url, /discord\.example/);
  assert.equal(stats.sent, 1);
  assert.equal(stats.fallbackSent, 1);
  assert.equal(stats.failed, 0);
  assert.equal(stats.channels.telegram.failed, 2);
  assert.equal(stats.channels.discord.sent, 1);
  assert.ok(notificationWarnings(stats).some((line) => line.includes("yedek")));
});

test("iki kanal da düşerse hata redakte edilir ve görünür kalır", async () => {
  const { calls, fetchImpl } = sequenceFetch([
    { ok: false, status: 500 },
    { ok: false, status: 500 },
    { ok: false, status: 500 },
  ]);
  const logs = [];
  const notifier = createEnvelopeNotifier({
    env: { ...telegramEnv, ...discordEnv },
    retryLimit: 1,
    retryDelayMs: 0,
    minGapMs: 0,
    now: () => NOW,
    fetchImpl,
    log: (line) => logs.push(line),
  });
  notifier.offer(reward(), meta);
  const stats = await notifier.settle();
  assert.equal(calls.length, 4);
  assert.equal(stats.failed, 1);
  assert.equal(stats.sent, 0);
  assert.match(stats.lastError, /discord:/);
  assert.ok(logs.every((line) => !line.includes("gizli-token") && !line.includes("discord.example")), logs.join(" | "));
  assert.ok(notificationWarnings(stats).some((line) => line.includes("teslim edilemedi")));
});

test("kalıcı Telegram hatası yedek kanalı bekletmeden dener", async () => {
  const { calls, fetchImpl } = sequenceFetch([
    { ok: false, status: 400, payload: { ok: false, description: "chat not found" } },
    { ok: true, status: 200 },
  ]);
  const notifier = createEnvelopeNotifier({
    env: { ...telegramEnv, ...discordEnv },
    retryLimit: 2,
    retryDelayMs: 0,
    minGapMs: 0,
    now: () => NOW,
    fetchImpl,
  });
  notifier.offer(reward(), meta);
  const stats = await notifier.settle();
  assert.equal(calls.length, 2);
  assert.equal(stats.retries, 0);
  assert.equal(stats.fallbackSent, 1);
  assert.equal(stats.failed, 0);
});

test("bildirim istatistikleri shard ve yerel sayaçlardan birleşir", () => {
  const merged = mergeNotificationStats([
    {
      disabled: false,
      sent: 1,
      failed: 0,
      attempts: 2,
      retries: 1,
      channels: { telegram: { sent: 1, failed: 1 } },
      lastFailureAt: "2026-11-21T20:00:00.000Z",
      lastError: "telegram: HTTP 500",
    },
    {
      disabled: false,
      sent: 2,
      failed: 1,
      attempts: 5,
      retries: 2,
      channels: { discord: { sent: 2, failed: 3 } },
      lastFailureAt: "2026-11-21T20:01:00.000Z",
      lastError: "discord: HTTP 503",
    },
  ]);
  assert.equal(merged.disabled, false);
  assert.equal(merged.sent, 3);
  assert.equal(merged.failed, 1);
  assert.equal(merged.attempts, 7);
  assert.equal(merged.retries, 3);
  assert.deepEqual(merged.channels.telegram, { sent: 1, failed: 1 });
  assert.equal(merged.lastError, "discord: HTTP 503");
});
