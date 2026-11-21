#!/usr/bin/env node
/**
 * Arena Radar — Supabase aynası (isteğe bağlı).
 *
 * GitHub Actions'ta `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` tanımlıysa
 * üye defteri ve sandık/mektup kayıtları kalıcı Supabase tablolarına yazılır;
 * tanımlı değilse hiçbir istek üretilmez ve tarama normal çalışır.
 *
 * Tablolar `scripts/supabase-schema.sql` ile bir kez oluşturulur. Yazma
 * `merge-duplicates` ile yapılır, yani aynı yayıncı ya da zarf kimliği ikinci
 * kez geldiğinde satır çoğalmaz.
 *
 * Ortam değişkenleri:
 *   SUPABASE_URL               https://<proje>.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  Service role anahtarı (yalnızca Actions secret'ı)
 */
const CHUNK = 400;
const TIMEOUT_MS = 12_000;

const clean = (value, max = 300) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const int = (value) => {
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
};

async function upsert(url, key, table, conflict, rows) {
  let written = 0;
  const failures = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    if (i >= CHUNK * 12) break; // tek koşuda sınırsız yazma olmasın
    const chunk = rows.slice(i, i + CHUNK);
    try {
      const response = await fetch(`${url}/rest/v1/${table}?on_conflict=${conflict}`, {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(chunk),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 200);
        failures.push(`${table}: HTTP ${response.status} ${detail}`);
        continue;
      }
      written += chunk.length;
    } catch (error) {
      failures.push(`${table}: ${error instanceof Error ? error.message : "hata"}`);
    }
  }
  return { written, failures };
}

/**
 * @param {{ roster: { streamers: unknown[], updatedAt: string }, snapshot: { chests: unknown[], generatedAt: string } }} input
 * @returns {Promise<{ skipped: boolean, streamers: number, chests: number, errors: number, detail: string[] }>}
 */
export async function mirrorToSupabase({ roster, snapshot }) {
  const url = clean(process.env.SUPABASE_URL, 200).replace(/\/+$/, "");
  const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY, 4_000);
  if (!url || !key) return { skipped: true, streamers: 0, chests: 0, errors: 0, detail: [] };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(url)) {
    return { skipped: true, streamers: 0, chests: 0, errors: 0, detail: [`SUPABASE_URL geçersiz: ${url.slice(0, 60)}`] };
  }

  const streamers = (Array.isArray(roster?.streamers) ? roster.streamers : [])
    .filter((row) => clean(row?.username, 40))
    .map((row) => ({
      username: clean(row.username, 40).toLowerCase(),
      nickname: clean(row.nickname, 120) || clean(row.username, 40),
      avatar: clean(row.avatar, 500),
      region: clean(row.region, 4).toUpperCase(),
      room_id: clean(row.roomId, 24),
      first_seen: clean(row.firstSeen, 40) || roster.updatedAt,
      last_seen: clean(row.lastSeen, 40) || roster.updatedAt,
      last_live_at: clean(row.lastLiveAt, 40) || null,
      live_count: int(row.liveCount),
      updated_at: roster.updatedAt,
    }));

  const chests = (Array.isArray(snapshot?.chests) ? snapshot.chests : [])
    .filter((row) => clean(row?.envelopeId, 80) && clean(row?.username, 40))
    .map((row) => ({
      envelope_id: clean(row.envelopeId, 80),
      room_id: clean(row.roomId, 24),
      username: clean(row.username, 40).toLowerCase(),
      nickname: clean(row.nickname, 120),
      title: clean(row.title, 200),
      kind: clean(row.kind, 20) || "chest",
      variant: clean(row.variant, 40),
      skin_id: int(row.skinId),
      business_type: int(row.businessType),
      coins: int(row.coins),
      slots: int(row.slots),
      ratio: Number(row.ratio) || 0,
      viewers: int(row.viewers),
      opens_at: clean(row.opensAt, 40) || null,
      detected_at: clean(row.detectedAt, 40) || null,
      last_seen_at: clean(row.lastSeenAt, 40) || null,
      status: clean(row.status, 20) || "waiting",
      open_url: clean(row.openUrl, 300),
      updated_at: snapshot.generatedAt,
    }));

  const [rosterResult, chestResult] = await Promise.all([
    streamers.length ? upsert(url, key, "radar_streamers", "username", streamers) : { written: 0, failures: [] },
    chests.length ? upsert(url, key, "radar_chests", "envelope_id", chests) : { written: 0, failures: [] },
  ]);
  const detail = [...rosterResult.failures, ...chestResult.failures];
  if (detail.length) console.warn(`[arena-radar] Supabase uyarısı: ${detail.slice(0, 3).join(" · ")}`);
  return {
    skipped: false,
    streamers: rosterResult.written,
    chests: chestResult.written,
    errors: detail.length,
    detail,
  };
}
