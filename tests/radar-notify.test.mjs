import test from "node:test";
import assert from "node:assert/strict";
import { createEnvelopeNotifier, envelopeMessage, notificationTarget } from "../scripts/radar-notify.mjs";

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
    return { ok: response.ok, status: response.status, json: async () => response.payload };
  };
  return { calls, fetchImpl };
}

const discordEnv = { ARENA_DISCORD_WEBHOOK_URL: "https://discord.example/api/webhooks/abc/def" };

test("kanal yalnızca ortamdan seçilir", () => {
  assert.equal(notificationTarget({}), null);
  assert.equal(notificationTarget({ ARENA_TELEGRAM_BOT_TOKEN: "t" })?.channel, undefined);
  assert.equal(notificationTarget({ ARENA_TELEGRAM_BOT_TOKEN: "t", ARENA_TELEGRAM_CHAT_ID: "1" })?.channel, "telegram");
  assert.equal(notificationTarget(discordEnv)?.channel, "discord");
  // Telegram iki parçası da varsa Discord'a düşülmez.
  assert.equal(notificationTarget({ ...discordEnv, ARENA_TELEGRAM_BOT_TOKEN: "t", ARENA_TELEGRAM_CHAT_ID: "1" })?.channel, "telegram");
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
  await silent.settle();
  assert.equal(calls.length, 0);
  assert.ok(logs.some((line) => line.includes("tanımlı değil")), logs.join(" | "));
});

test("telegram hatası taramayı düşürmez ve token log'a sızmaz", async () => {
  const { calls, fetchImpl } = fakeFetch({ ok: false, status: 500, payload: { ok: false, description: "Bad Request" } });
  const logs = [];
  const notifier = createEnvelopeNotifier({
    env: { ARENA_TELEGRAM_BOT_TOKEN: "gizli-token", ARENA_TELEGRAM_CHAT_ID: "42" },
    minGapMs: 0,
    now: () => NOW,
    fetchImpl,
    log: (line) => logs.push(line),
  });
  notifier.offer(reward(), meta);
  const stats = await notifier.settle();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /api\.telegram\.org/);
  assert.equal(calls[0].body.chat_id, "42");
  assert.equal(stats.failed, 1);
  assert.ok(logs.every((line) => !line.includes("gizli-token")), logs.join(" | "));
});
