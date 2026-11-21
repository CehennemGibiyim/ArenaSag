import test from "node:test";
import assert from "node:assert/strict";
import {
  LIVE_WINDOW_MS,
  orderRoster,
  pageRoster,
  rosterHandle,
  rosterLiveState,
} from "../src/lib/roster-page";

const member = (username: string, firstSeen: string) => ({ username, firstSeen });
const members = [
  member("c", "2026-01-03T00:00:00.000Z"),
  member("a", "2026-01-01T00:00:00.000Z"),
  member("b", "2026-01-02T00:00:00.000Z"),
  member("d", "2026-01-04T00:00:00.000Z"),
  member("e", "2026-01-05T00:00:00.000Z"),
];

test("defter en eski üyeden başlayarak sıralanır", () => {
  assert.deepEqual(orderRoster(members).map((row) => row.username), ["a", "b", "c", "d", "e"]);
});

test("sayfalama imleci ilerletir ve başa döner", () => {
  const ordered = orderRoster(members);
  const first = pageRoster(ordered, 0, 2);
  assert.deepEqual(first.items.map((row) => row.username), ["a", "b"]);
  assert.equal(first.nextCursor, 2);
  assert.equal(first.wrapped, false);
  assert.equal(first.total, 5);

  const second = pageRoster(ordered, first.nextCursor, 2);
  assert.deepEqual(second.items.map((row) => row.username), ["c", "d"]);
  assert.equal(second.nextCursor, 4);

  const third = pageRoster(ordered, second.nextCursor, 2);
  assert.deepEqual(third.items.map((row) => row.username), ["e", "a"]);
  assert.equal(third.nextCursor, 1);
  assert.equal(third.wrapped, true);
});

test("boş defter ve büyük imleç güvenli", () => {
  assert.deepEqual(pageRoster([], 4, 10), { items: [], nextCursor: 0, wrapped: false, total: 0 });
  const wrapped = pageRoster(orderRoster(members), 12, 2);
  assert.deepEqual(wrapped.items.map((row) => row.username), ["c", "d"]);
});

test("canlı penceresi 30 dakika", () => {
  const now = Date.parse("2026-01-01T12:00:00.000Z");
  assert.equal(rosterLiveState({ lastLiveAt: new Date(now - 60_000).toISOString() }, now), true);
  assert.equal(rosterLiveState({ lastLiveAt: new Date(now - LIVE_WINDOW_MS - 1).toISOString() }, now), false);
  assert.equal(rosterLiveState({ lastLiveAt: "" }, now), false);
});

test("kullanıcı adı normalizasyonu", () => {
  assert.equal(rosterHandle("@Elif.Live"), "elif.live");
  assert.equal(rosterHandle("gecersiz isim!"), "");
});
