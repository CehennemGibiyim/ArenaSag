import { EventEmitter } from "node:events";
import EulerClient from "tiktok-live-api-sdk";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cohostCandidates, listenerJobs, liveRooms, type ListenerJob } from "@/db/schema";
import { deriveChest, GiftFlow, recordChest, upsertFlow, type EnvelopeFields } from "@/server/chest";
import { bumpRoomChest } from "@/server/rooms";
import { envelopeReward, bagReward } from "@/server/rewards";
import { getSettings } from "@/server/settings";
import { battlePeers, obj } from "@/lib/discovery-model";
import { claimRoom, enqueue, leaseEnd, owned } from "@/server/listener-queue";
import { failurePolicy, localCapacity } from "@/server/listener-policy";
import { roomInfo } from "@/server/discovery";
import { pauseProvider, signingKey, signingQuota } from "@/server/free-discovery";

const state = globalThis as typeof globalThis & { __arenaListenerTimer?: ReturnType<typeof setInterval>; __arenaListeningTick?: boolean };
export const enqueueVerifiedRoom = enqueue;

async function listen(job: ListenerJob) {
  const { TikTokLiveConnection, WebcastEvent, ControlEvent } = await import("tiktok-live-connector");
  const conn = new TikTokLiveConnection(job.username, { fetchRoomInfoOnConnect: false, processInitialData: true, enableExtendedGiftInfo: false,
    eulerApiInstance: new EulerClient({ basePath: "https://api.eulerstream.com", apiKey: signingKey(), baseOptions: {
      timeout: 10_000, validateStatus: () => true, headers: { "User-Agent": "ArenaLiveOS/1.2 (tiktok-live-connector/2.5.0)" } } }), wsClientOptions: { handshakeTimeout: 12_000 } });
  let closing = false, connected = false, heartbeatBusy = false, ended = false, ownedLease = true;
  let error: unknown = new Error("Bağlantı kesildi.");
  let signalClose!: () => void;
  const closed = new Promise<void>(resolve => { signalClose = resolve; });
  const finish = (e?: unknown) => { if (e) error = e; signalClose(); };
  const flow = new GiftFlow(), peers = new Set<string>();
  const meta = { username: job.username, nickname: job.nickname, title: job.title, roomId: job.roomId, viewers: job.viewers };
  const sameRoom = and(eq(liveRooms.username, job.username), eq(liveRooms.roomId, job.roomId));
  const save = async (fields: EnvelopeFields | null) => {
    if (!fields || closing || !ownedLease || (fields.roomId && fields.roomId !== job.roomId)) return;
    const chest = await recordChest(fields, meta, "connector");
    if (chest) { flow.markEnvelope(job.username, chest.envelopeId); await bumpRoomChest(job.username, chest.coins, chest.slots, deriveChest(chest).ratio); }
  };
  const saveRoom = async () => {
    const info = await roomInfo(job.roomId);
    if (!closing && info.roomId === job.roomId && (!info.username || info.username === job.username)) {
      for (const reward of info.rewards) await save(reward);
    }
  };
  conn.on(WebcastEvent.ENVELOPE, raw => { void save(envelopeReward(raw, job.roomId)).catch(() => null); });
  conn.on(ControlEvent.DECODED_DATA, (method, raw) => { if (String(method) === "WebcastGoodyBagMessage") void save(bagReward(obj(raw).data ?? raw, job.roomId)).catch(() => null); });
  // Optional event in future decoders; do not manufacture bags when no schema is delivered.
  (conn as unknown as EventEmitter).on("goodyBag", (raw: unknown) => { void save(bagReward(raw,job.roomId)).catch(() => null); });
  conn.on(WebcastEvent.LINK_MIC_BATTLE, raw => {
    if (closing || peers.size >= 32) return;
    // Only anchorsInfo[].value.user is a broadcaster. Never treat chatters or gifters as hosts.
    const fresh = battlePeers(raw, job.roomId).filter(peer => !peers.has(peer.roomId) && peer.username !== job.username).slice(0, 32 - peers.size);
    if (!fresh.length) return;
    for (const peer of fresh) peers.add(peer.roomId);
    void db.insert(cohostCandidates).values(fresh.map(({ username, roomId, nickname }) => ({ username, roomId, nickname }))).onConflictDoUpdate({ target: cohostCandidates.roomId, set: { seenAt: new Date() } }).catch(() => null);
  });
  conn.on(WebcastEvent.GIFT, raw => {
    if (closing) return;
    const item = obj(raw), user = obj(item.user), gift = obj(item.giftDetails);
    flow.addGift(job.username, meta, { user: String(user.displayId ?? user.uniqueId ?? "?"), giftId: String(item.giftId ?? ""),
      diamonds: Number(gift.diamondCount ?? item.diamondCount ?? 0), repeatCount: Number(item.repeatCount ?? 1) });
  });
  conn.on(WebcastEvent.ROOM_USER, raw => { const count = Number(obj(raw).viewerCount); if (Number.isSafeInteger(count) && count >= 0) meta.viewers = count; });
  conn.on(ControlEvent.DISCONNECTED, () => finish());
  conn.on(WebcastEvent.STREAM_END, () => { ended = true; finish(); });
  conn.on(ControlEvent.ERROR, raw => { const e = obj(raw).exception; if (!connected || failurePolicy(e, 0).shared) finish(e ?? raw); });
  // Renew even during the handshake. A lost lease terminates this attempt, never another worker's socket.
  const heartbeat = setInterval(() => {
    if (heartbeatBusy || closing) return;
    heartbeatBusy = true;
    void db.transaction(async tx => {
      const [kept] = await tx.update(listenerJobs).set({ leaseUntil: leaseEnd(), updatedAt: new Date(), viewers: meta.viewers })
        .where(owned(job)).returning({ id: listenerJobs.id });
      if (!kept) { ownedLease = false; finish(); return; }
      if (connected) await tx.update(liveRooms).set({ monitoring: true, liveNow: true, verifiedAt: new Date(), viewers: meta.viewers }).where(sameRoom);
    }).catch(() => { ownedLease = false; finish(); }).finally(() => { heartbeatBusy = false; });
  }, 12_000);
  let refresh: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // If the external handshake resolves after cancellation, close it rather than leaving an unowned socket.
    const handshake = conn.connect(job.roomId).then(async result => {
      if (closing || !ownedLease) { await conn.disconnect(); return false; }
      return result.roomId === job.roomId && result.isConnected;
    });
    const ok = await Promise.race([handshake, closed.then(() => false), new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 28_000); })]);
    clearTimeout(timeout);
    if (!ok || !ownedLease) return;
    const [started] = await db.update(listenerJobs).set({ status: "listening", connectedAt: new Date(), attempts: 0,
      leaseUntil: leaseEnd(), lastError: "", updatedAt: new Date() }).where(owned(job)).returning({ id: listenerJobs.id });
    if (!started) { ownedLease = false; return; }
    connected = true;
    await db.update(liveRooms).set({ monitoring: true, verifiedAt: new Date() }).where(sameRoom);
    void saveRoom().catch(() => null);
    refresh = setInterval(() => { void saveRoom().catch(() => null); for (const row of flow.rows()) void upsertFlow({ ...row, liveNow: true }).catch(() => null); }, 120_000);
    await closed;
  } catch (e) { error = e; }
  finally {
    closing = true;
    clearInterval(heartbeat); clearInterval(refresh); clearTimeout(timeout);
    const policy = failurePolicy(error, connected ? 0 : job.attempts);
    if (policy.shared) await pauseProvider("listener", policy.wait, policy.detail).catch(() => null);
    await conn.disconnect().catch(() => null);
    if (ownedLease) {
      ended ||= policy.offline;
      for (const row of flow.rows()) await upsertFlow({ ...row, liveNow: !ended }).catch(() => null);
      await db.transaction(async tx => {
        const [released] = await tx.update(listenerJobs).set({ status: ended ? "offline" : "retry", owner: "", leaseUntil: null, connectedAt: null,
          attempts: connected ? 1 : sql`${listenerJobs.attempts} + 1`, lastError: ended ? "Yayın bitti." : policy.detail,
          nextAttemptAt: new Date(Date.now() + policy.wait), updatedAt: new Date() }).where(owned(job)).returning({ id: listenerJobs.id });
        if (released) await tx.update(liveRooms).set({ monitoring: false, ...(ended ? { liveNow: false } : {}) }).where(sameRoom);
      });
    }
  }
}
export async function tick() {
  if (state.__arenaListeningTick) return;
  state.__arenaListeningTick = true;
  try {
    const limits = await signingQuota();
    if (limits.state === "limited" || limits.state === "loading" || (limits.state === "error" && /401|403/.test(limits.detail))) return;
    const job = await claimRoom(localCapacity(await getSettings()), limits.quota);
    if (job) void listen(job).catch(() => null);
  } finally { state.__arenaListeningTick = false; }
}
export function startListenerWorker() {
  if (state.__arenaListenerTimer) return;
  state.__arenaListenerTimer = setInterval(() => void tick().catch(() => null), 3500);
  void tick().catch(() => null);
}
