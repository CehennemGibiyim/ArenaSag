import assert from "node:assert/strict";
import test from "node:test";
import { ratioOf, secondsLeft, shouldAlert } from "../desktop/alert-rules.mjs";

const NOW = Date.parse("2026-11-21T12:00:00.000Z");
const chest = (overrides = {}) => ({
  envelopeId: "env-1",
  coins: 700,
  slots: 100,
  opensAt: new Date(NOW + 120_000).toISOString(),
  ...overrides,
});

test("ratioOf jeton/kontenjan oranını iki basamağa yuvarlar", () => {
  assert.equal(ratioOf({ coins: 500, slots: 20 }), 25);
  assert.equal(ratioOf({ coins: 700, slots: 300 }), 2.33);
});

test("ratioOf hazır ratio alanını tercih eder", () => {
  assert.equal(ratioOf({ ratio: 9.5, coins: 1, slots: 99 }), 9.5);
});

test("ratioOf sıfır kontenjanda bölme hatası vermez", () => {
  assert.equal(ratioOf({ coins: 10, slots: 0 }), 10);
});

test("secondsLeft açılıştan önce pozitif, sonra negatif", () => {
  assert.equal(secondsLeft({ opensAt: new Date(NOW + 90_000).toISOString() }, NOW), 90);
  assert.equal(secondsLeft({ opensAt: new Date(NOW - 45_000).toISOString() }, NOW), -45);
  assert.equal(secondsLeft({ opensAt: "bozuk" }, NOW), 0);
});

test("shouldAlert pencerenin içindeki yüksek oranlı sandığı bildirir", () => {
  assert.equal(shouldAlert(chest({ coins: 900, slots: 100 }), { alertRatio: 7, alertSeconds: 180 }, NOW), true);
});

test("shouldAlert eşik altındaki oranı susturur", () => {
  assert.equal(shouldAlert(chest({ coins: 300, slots: 100 }), { alertRatio: 7, alertSeconds: 180 }, NOW), false);
});

test("shouldAlert pencere dışındaki sandığı susturur", () => {
  assert.equal(shouldAlert(chest({ opensAt: new Date(NOW + 600_000).toISOString() }), { alertRatio: 7, alertSeconds: 180 }, NOW), false);
});

test("shouldAlert 30 saniyeden fazla geçmiş açılışı yok sayar", () => {
  assert.equal(shouldAlert(chest({ opensAt: new Date(NOW - 120_000).toISOString() }), { alertRatio: 7, alertSeconds: 180 }, NOW), false);
});

test("shouldAlert otuz saniyelik hoşgörü içinde bildirir", () => {
  assert.equal(shouldAlert(chest({ opensAt: new Date(NOW - 10_000).toISOString() }), { alertRatio: 7, alertSeconds: 180 }, NOW), true);
});

test("shouldAlert immediate modunda pencereyi beklemez", () => {
  assert.equal(shouldAlert(chest({ opensAt: new Date(NOW + 3_600_000).toISOString() }), { alertRatio: 7, alertSeconds: 180, immediate: true }, NOW), true);
});

test("shouldAlert 24 saatten uzak açılışı yok sayar", () => {
  assert.equal(shouldAlert(chest({ opensAt: new Date(NOW + 48 * 3_600_000).toISOString() }), { alertRatio: 7, alertSeconds: 180, immediate: true }, NOW), false);
});
