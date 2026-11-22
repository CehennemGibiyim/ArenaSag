import test from "node:test";
import assert from "node:assert/strict";
import { MAX_AGE_MS, decideChange, roomKeys, sameSet } from "../scripts/data-changed.mjs";

const now = Date.parse("2026-01-01T12:00:00.000Z");

function arena(patch = {}) {
  return {
    schema: 1,
    generatedAt: new Date(now).toISOString(),
    streams: [
      { roomId: "1", username: "a", viewers: 10, title: "A" },
      { roomId: "2", username: "b", viewers: 20, title: "B" },
    ],
    chests: [{ envelopeId: "e1", coins: 100, slots: 10, opensAt: "2026-01-01T12:05:00.000Z" }],
    ...patch,
  };
}

const roster = (total) => ({ schema: 1, total, streamers: [] });

test("izleyici/sıralama/zaman değişimi yayın gerektirmez", () => {
  const next = arena({
    generatedAt: new Date(now + 60_000).toISOString(),
    streams: [
      { roomId: "2", username: "b", viewers: 99, title: "B2" },
      { roomId: "1", username: "a", viewers: 1, title: "A2" },
    ],
  });
  const result = decideChange({ prevArena: arena(), nextArena: next, prevRoster: roster(5), nextRoster: roster(5), now: now + 60_000 });
  assert.equal(result.changed, false);
  assert.equal(result.reason, "anlamli-degisiklik-yok");
});

test("yeni canlı oda yayın tetikler", () => {
  const next = arena({ streams: [...arena().streams, { roomId: "3", username: "c", viewers: 5 }] });
  const result = decideChange({ prevArena: arena(), nextArena: next, prevRoster: roster(5), nextRoster: roster(5), now });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "oda-degisti");
});

test("sandık ödülü değişimi yayın tetikler", () => {
  const next = arena({ chests: [{ envelopeId: "e1", coins: 200, slots: 10, opensAt: "2026-01-01T12:05:00.000Z" }] });
  const result = decideChange({ prevArena: arena(), nextArena: next, prevRoster: roster(5), nextRoster: roster(5), now });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "sandik-degisti");
});

test("üye defteri büyümesi yayın tetikler", () => {
  const result = decideChange({ prevArena: arena(), nextArena: arena(), prevRoster: roster(5), nextRoster: roster(6), now });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "uye-defteri-buyudu");
});

test("zarf şeması uyarısı yayın tetikler", () => {
  const next = arena({
    warnings: ["Zarf şeması sürüklenmesi: bilinmeyen zarf/çanta mesaj tipi WebcastEnvelopeMessageV2 (4)."],
    health: { unknownEnvelopeTypes: ["WebcastEnvelopeMessageV2"] },
  });
  const result = decideChange({ prevArena: arena(), nextArena: next, prevRoster: roster(5), nextRoster: roster(5), now });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "uyari-degisti");
});

test("tip sessizliği uyarısı yayın tetikler", () => {
  const next = arena({
    warnings: [
      "Zarf tipi sessiz: WebcastEnvelopeMessage (son görülme 2026-01-02 11:20 UTC, gözlenen aralık ~10 dk, eşik 30 dk). Başka zarf tipi akıyor: WebcastGoodyBagMessage.",
    ],
  });
  const result = decideChange({ prevArena: arena(), nextArena: next, prevRoster: roster(5), nextRoster: roster(5), now });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "uyari-degisti");
});

test("bildirim teslimat uyarısı yayın tetikler", () => {
  const next = arena({
    warnings: ["Zarf bildirimi teslim edilemedi (1 mesaj, 3 deneme). Son hata: discord: HTTP 503"],
  });
  const result = decideChange({ prevArena: arena(), nextArena: next, prevRoster: roster(5), nextRoster: roster(5), now });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "uyari-degisti");
});

test("bayat veri değişiklik olmasa da tazelenir", () => {
  const result = decideChange({
    prevArena: arena({ generatedAt: new Date(now - MAX_AGE_MS - 1).toISOString() }),
    nextArena: arena(),
    prevRoster: roster(5),
    nextRoster: roster(5),
    now,
  });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "veri-bayat");
});

test("ilk yayında veri yoksa her zaman yayınlanır", () => {
  const result = decideChange({ prevArena: null, nextArena: arena(), prevRoster: null, nextRoster: roster(1), now });
  assert.equal(result.changed, true);
  assert.equal(result.reason, "ilk-yayin");
});

test("oda kimlikleri sıradan bağımsızdır", () => {
  assert.ok(sameSet(roomKeys(arena()), roomKeys(arena({ streams: [...arena().streams].reverse() }))));
});
