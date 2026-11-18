import { checkAlive, roomInfo, userRoom } from "@/server/discovery";
import { roomKey, type Candidate } from "@/lib/discovery-model";
import type { EnvelopeFields } from "@/server/chest";

type Observation = {
  seed: Candidate; state: "live" | "offline" | "unknown"; roomId: string; nickname: string; title: string;
  avatar: string; viewers: number; hostRegion: string; rewards: EnvelopeFields[];
};
async function parallel<T>(rows: T[], concurrency: number, fn: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, async () => {
    while (index < rows.length) await fn(rows[index++]);
  }));
}
/** Verify the @handle -> room mapping, then batch check_alive. Missing or malformed results are UNKNOWN. */
export async function verifyCandidates(candidates: Candidate[]): Promise<Observation[]> {
  const observations: Observation[] = candidates.map(seed => ({ seed, state: "unknown", roomId: "", nickname: seed.nickname,
    title: "", avatar: "", viewers: 0, hostRegion: "", rewards: [] }));
  await parallel(observations, 4, async observation => {
    const info = await userRoom(observation.seed.username, 1).catch(() => null);
    if (!info || info.error) return;
    if (!roomKey(info.roomId)) { observation.state = "offline"; return; }
    Object.assign(observation, { roomId: info.roomId, nickname: info.nickname || observation.nickname, title: info.title, avatar: info.avatar });
  });
  const ids = [...new Set(observations.map(o => o.roomId).filter(Boolean))];
  const alive = await checkAlive(ids);
  await parallel(observations.filter(o => o.roomId), 4, async o => {
    if (alive[o.roomId] === false) { o.state = "offline"; return; }
    if (alive[o.roomId] !== true) return;
    const extra = await roomInfo(o.roomId);
    if (extra.roomId !== o.roomId || (extra.username && extra.username !== o.seed.username)) return;
    Object.assign(o, { state: "live", title: extra.title || o.title, avatar: extra.avatar || o.avatar,
      nickname: extra.nickname || o.nickname, viewers: extra.viewers, hostRegion: extra.country, rewards: extra.rewards });
  });
  return observations;
}
