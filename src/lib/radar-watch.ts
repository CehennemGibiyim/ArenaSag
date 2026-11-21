/**
 * WebSocket zarf dinleme durumu.
 *
 * `radar-publish.mjs` bu alanları `arena-live.json → watch` olarak yazar, sunucu
 * radar senkronu okur ve panel gösterir. Tip tek yerde tanımlıdır ki üç taraf
 * sessizce ayrışmasın; yeni bir alan eklenirse hem okuyan hem yazan buradan görür.
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
};

/** Panelin `/api/radar/watch` (ve senkron sonucu) yanıtından okuduğu özet. */
export type RadarWatchState = {
  watch: RadarWatch | null;
  warnings: string[];
  /** Senkron başarısızsa neden; başarılı senkronda boş. */
  error?: string;
};
