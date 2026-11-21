/**
 * WebSocket zarf dinleme durumu.
 *
 * `scripts/radar-publish.mjs` bu alanları `arena-live.json → watch` olarak yazar,
 * `scripts/radar-contract.mjs` yayın öncesi bağımsız olarak doğrular. Sunucu ve
 * panel ise aynı okuyucuyu (`readWatch`) kullanır; tip ile okuyucu tek dosyada
 * durur ki yeni bir alan eklendiğinde alan listesi iki yerde ayrışmasın.
 */
export type RadarWatch = {
  requested: number;
  connected: number;
  failed: number;
  seconds: number;
  envelopes: number;
  rateLimited: boolean;
  rateLimitHits: number;
  signedWithKey: boolean;
  /** Yakalanan WS mesaj türleri; sözleşme bu alanı da doğrular. */
  messageTypes: Record<string, number>;
};

/** `/api/radar/watch` yanıtı; panel yalnızca bu alanları gösterir. */
export type RadarWatchSnapshot = {
  watch: RadarWatch | null;
  warnings: string[];
  /** Yayınlanan anlık görüntünün üretildiği an; yaş hesabı buradan yapılır. */
  generatedAt: string | null;
  /** Anlık görüntü okunamazsa neden; başarılı okumada boş. */
  error?: string;
};

/** `watch` alanını eksik/bozuk değerlere karşı güvenli sayılara indirger. */
export function readWatch(value: unknown): RadarWatch | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Partial<RadarWatch>;
  const messageTypes: Record<string, number> = {};
  if (row.messageTypes && typeof row.messageTypes === "object" && !Array.isArray(row.messageTypes)) {
    for (const [type, count] of Object.entries(row.messageTypes)) {
      const hits = Number(count ?? 0) || 0;
      if (hits > 0) messageTypes[type] = hits;
    }
  }
  return {
    requested: Number(row.requested ?? 0) || 0,
    connected: Number(row.connected ?? 0) || 0,
    failed: Number(row.failed ?? 0) || 0,
    seconds: Number(row.seconds ?? 0) || 0,
    envelopes: Number(row.envelopes ?? 0) || 0,
    rateLimited: row.rateLimited === true,
    rateLimitHits: Number(row.rateLimitHits ?? 0) || 0,
    signedWithKey: row.signedWithKey === true,
    messageTypes,
  };
}

/** `generatedAt` alanını ISO metnine indirger; eksik veya geçersizse `null`. */
export function readGeneratedAt(value: unknown): string | null {
  const ms = Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** `warnings` alanını boş satırlardan arındırıp panelde gösterilecek son 5 satıra indirir. */
export function readWarnings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => String(line ?? "").trim())
    .filter(Boolean)
    .slice(0, 5);
}
