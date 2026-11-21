/**
 * Arena Radar — sandık bildirim kuralları.
 *
 * Saf fonksiyonlar: dosya, ağ veya saat bağımlılığı yoktur; `now` dışarıdan
 * verilebilir. Böylece eşik ve zaman penceresi davranışı test edilebilir.
 */

const clamp = (value, min, max) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

/** Sandığın açılışına kalan saniye (geçmişse negatif). */
export function secondsLeft(chest, now = Date.now()) {
  const opens = Date.parse(chest && chest.opensAt ? chest.opensAt : "");
  return Number.isFinite(opens) ? Math.round((opens - now) / 1000) : 0;
}

/** Jeton ÷ kontenjan oranı; hazır `ratio` varsa o kullanılır. */
export function ratioOf(chest) {
  const value = Number(chest && chest.ratio);
  if (Number.isFinite(value) && value > 0) return value;
  const coins = Number(chest && chest.coins ? chest.coins : 0);
  const slots = Math.max(1, Number(chest && chest.slots ? chest.slots : 1));
  return Math.round((coins / slots) * 100) / 100;
}

/**
 * Bildirim verilmeli mi?
 *
 * - Oran `alertRatio` eşiğinin altındaysa hayır.
 * - Açılış 30 saniyeden fazla geçmişse hayır (kaçırılmış sandık).
 * - `immediate` (açılışta) veya kalan süre `alertSeconds` penceresindeyse evet.
 */
export function shouldAlert(chest, options = {}, now = Date.now()) {
  const minRatio = clamp(options.alertRatio ?? 7, 1, 100);
  const windowSeconds = clamp(options.alertSeconds ?? 180, 30, 1800);
  const ratio = ratioOf(chest);
  if (ratio < minRatio) return false;
  const left = secondsLeft(chest, now);
  if (left <= -30) return false;
  if (left > 24 * 60 * 60) return false;
  return options.immediate === true || left <= windowSeconds;
}
