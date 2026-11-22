#!/usr/bin/env node
/**
 * Zarf bildirimi — yakalanan zarfı GitHub Actions içinden, panel senkronunu ve
 * Pages yayınını beklemeden Telegram/Discord'a iletir.
 *
 * Adres yalnızca ortam değişkeninden (GitHub secret) okunur:
 *   ARENA_TELEGRAM_BOT_TOKEN + ARENA_TELEGRAM_CHAT_ID
 *   ARENA_DISCORD_WEBHOOK_URL
 * Değer hiçbir dosyaya yazılmaz, konsola basılmaz; hata metinlerinde geçerse
 * maskelenir. Kanal tanımlı değilse sessizce yutulmaz: health/uyarı ve tek satır
 * log nedeni taşır.
 *
 * Teslimat:
 *   - geçici hata (ağ, 408/429/5xx) aynı kanalda `retryLimit` kadar yeniden denenir,
 *   - kalıcı hata veya tükenen denemelerde sıradaki kanal yedek olarak denenir,
 *   - teslim edilen/edilmeyen mesajlar ve son hata redakte edilerek raporlanır.
 *
 * Spam koruması:
 *   - aynı `envelopeId` bir kez bildirilir (önceki yayındaki sandıklar + bu koşu),
 *   - koşu başına en fazla `maxPerRun` mesaj; fazlası gönderilmez, sayılır,
 *   - mesajlar arasında `minGapMs` beklenir (Telegram/Discord hız sınırına çarpmadan),
 *   - açılışı geçmiş zarf bildirilmez; zarf yoksa hiç istek atılmaz.
 *
 * Kullanım:
 *   const notifier = createEnvelopeNotifier({ known: [...ids] });
 *   notifier.offer(reward, { username, nickname, roomId });
 *   const stats = await notifier.settle();
 */

const text = (value, max = 160) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const integer = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
};

const DEFAULT_MAX_PER_RUN = 4;
const DEFAULT_MIN_GAP_MS = 1_500;
const DEFAULT_RETRY_LIMIT = 2;
const DEFAULT_RETRY_DELAY_MS = 750;
const SEND_TIMEOUT_MS = 8_000;

/** Yapılandırılmış tüm kanallar; Telegram önce, Discord yedek. */
export function notificationTargets(env = process.env) {
  const targets = [];
  const token = text(env.ARENA_TELEGRAM_BOT_TOKEN, 200);
  const chatId = text(env.ARENA_TELEGRAM_CHAT_ID, 64);
  if (token && chatId) targets.push({ channel: "telegram", token, chatId });
  const url = text(env.ARENA_DISCORD_WEBHOOK_URL, 500);
  if (url) targets.push({ channel: "discord", url });
  return targets;
}

/** Geriye uyumlu tek kanal seçimi; yeni kod `notificationTargets` kullanmalı. */
export function notificationTarget(env = process.env) {
  return notificationTargets(env)[0] ?? null;
}

const clock = (ms) => {
  const date = new Date(ms);
  return `${String(date.getUTCHours()).padStart(2, "0")}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
};

/** Bildirim metni — düz metin; Telegram'da parse_mode kullanılmaz (kaçış sorunları). */
export function envelopeMessage(reward, meta = {}, { now = Date.now(), requested = 0, signedWithKey = false } = {}) {
  const username = text(meta.username, 24).replace(/^@+/, "");
  const nickname = text(meta.nickname, 60);
  const coins = integer(reward?.coins);
  const slots = integer(reward?.slots);
  const ratio = slots ? Math.round((coins / slots) * 10) / 10 : 0;
  const opensMs = Number(reward?.opensAt) * 1000;
  const remaining = Number.isFinite(opensMs) ? Math.max(0, Math.round((opensMs - now) / 60_000)) : 0;

  const lines = [`🎁 Zarf yakalandı · ${coins} jeton / ${slots} kişi (${ratio} jeton/kişi)`];
  if (username) lines.push(`👤 @${username}${nickname && nickname !== username ? ` · ${nickname}` : ""}`);
  lines.push(`⏱ Açılış ${Number.isFinite(opensMs) ? clock(opensMs) : "bilinmiyor"} · ${remaining} dk kaldı`);
  if (username) lines.push(`🔗 https://www.tiktok.com/@${username}/live`);
  if (requested > 0) lines.push(`📡 WS ${requested} oda · ${signedWithKey ? "anahtarlı imza" : "ücretsiz imza"}`);
  return lines.join("\n");
}

const emptyStats = () => ({
  sent: 0,
  failed: 0,
  skipped: 0,
  queued: 0,
  attempts: 0,
  retries: 0,
  fallbackSent: 0,
  disabled: true,
  channels: {},
  lastError: null,
  lastFailureAt: null,
});

/**
 * Shard ve birleştirme işindeki bildirim sayaçlarını birleştirir. Kanal
 * nesnelerinde yalnızca sayaçlar tutulur; URL/token asla dışarı çıkmaz.
 */
export function mergeNotificationStats(statsList) {
  const rows = Array.isArray(statsList) ? statsList.filter(Boolean) : [];
  const merged = emptyStats();
  if (!rows.length) return merged;
  merged.disabled = true;
  for (const stats of rows) {
    if (
      stats.disabled === false ||
      integer(stats.attempts) > 0 ||
      integer(stats.sent) > 0 ||
      Object.keys(stats.channels && typeof stats.channels === "object" ? stats.channels : {}).length > 0
    ) {
      merged.disabled = false;
    }
    for (const key of ["sent", "failed", "skipped", "queued", "attempts", "retries", "fallbackSent"]) {
      merged[key] += integer(stats[key]);
    }
    for (const [channel, row] of Object.entries(stats.channels && typeof stats.channels === "object" ? stats.channels : {})) {
      const current = merged.channels[channel] || { sent: 0, failed: 0 };
      current.sent += integer(row?.sent);
      current.failed += integer(row?.failed);
      merged.channels[channel] = current;
    }
    if (stats.lastFailureAt) {
      const previous = Date.parse(String(merged.lastFailureAt ?? ""));
      const next = Date.parse(String(stats.lastFailureAt));
      if (Number.isFinite(next) && (!Number.isFinite(previous) || next >= previous)) {
        merged.lastFailureAt = new Date(next).toISOString();
        merged.lastError = text(stats.lastError, 240) || merged.lastError;
      }
    }
  }
  return merged;
}

/** Teslimat sorununu panelin göstereceği insan diline çevirir; sessiz kayıp yok. */
export function notificationWarnings(stats) {
  if (!stats) return [];
  if (stats.disabled) {
    return [
      "Zarf bildirimi kapalı: ARENA_TELEGRAM_BOT_TOKEN/ARENA_TELEGRAM_CHAT_ID veya ARENA_DISCORD_WEBHOOK_URL tanımlı değil. Yakalanan zarflar yalnızca panelde görünür.",
    ];
  }
  const warnings = [];
  if (stats.failed > 0) {
    warnings.push(
      `Zarf bildirimi teslim edilemedi (${stats.failed} mesaj, ${stats.attempts} deneme).` +
        (stats.lastError ? ` Son hata: ${stats.lastError}` : ""),
    );
  } else if (stats.fallbackSent > 0) {
    warnings.push(`Zarf bildirimi ${stats.fallbackSent} kez yedek kanaldan gönderildi.`);
  }
  if (stats.retries > 0 && stats.failed === 0) {
    warnings.push(`Zarf bildirimi ${stats.retries} kez yeniden denendikten sonra gönderildi.`);
  }
  return warnings;
}

/**
 * Sıralı, sınırlı ve tekrarsız bildirim kuyruğu.
 *
 * `offer` hiçbir zaman fırlatmaz ve ağ beklemez: zarf dinleme sürerken çağrılır,
 * gönderim kendi zincirinde ilerler. `settle` kuyruk boşalana kadar bekler.
 */
export function createEnvelopeNotifier({
  env = process.env,
  known = [],
  context = {},
  maxPerRun = DEFAULT_MAX_PER_RUN,
  minGapMs = DEFAULT_MIN_GAP_MS,
  retryLimit = DEFAULT_RETRY_LIMIT,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))),
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const targets = notificationTargets(env);
  const stats = emptyStats();
  stats.disabled = targets.length === 0;
  stats.channels = Object.fromEntries(targets.map((target) => [target.channel, { sent: 0, failed: 0 }]));
  const seen = new Set();
  for (const id of known) {
    const envelopeId = text(id, 80);
    if (envelopeId) seen.add(envelopeId);
  }
  const queue = [];
  let chain = Promise.resolve();
  let lastSentAt = 0;

  if (!targets.length) {
    log(
      "zarf bildirimi kapalı: ARENA_TELEGRAM_BOT_TOKEN/ARENA_TELEGRAM_CHAT_ID veya " +
        "ARENA_DISCORD_WEBHOOK_URL tanımlı değil",
    );
  }

  // Hata metni adresi/token'ı taşıyabilir; log ve health'e yalnızca maskelenmiş hâli gider.
  const redact = (message) => {
    let clean = text(message, 240) || "hata";
    for (const target of targets) {
      for (const secret of [target.token, target.url, target.chatId]) {
        if (secret) clean = clean.split(secret).join("***");
      }
    }
    return clean;
  };

  const sendTo = async (target, body) => {
    if (target.channel === "telegram") {
      const response = await fetchImpl(`https://api.telegram.org/bot${target.token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: target.chatId, text: body, disable_web_page_preview: true }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) {
        const error = new Error(`HTTP ${response.status}${payload.description ? ` · ${payload.description}` : ""}`);
        error.status = response.status;
        error.retryAfter = Number(response.headers?.get?.("retry-after") || 0) * 1000;
        throw error;
      }
      return;
    }
    const response = await fetchImpl(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Metindeki "@everyone" gibi diziler Discord'da bahsetmeye dönüşmesin.
      body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfter = Number(response.headers?.get?.("retry-after") || 0) * 1000;
      throw error;
    }
  };

  const retryable = (error) => {
    const status = Number(error?.status || 0);
    return !status || status === 408 || status === 429 || status >= 500;
  };

  const deliver = async ({ reward, meta }) => {
    const gap = minGapMs - (now() - lastSentAt);
    if (gap > 0) await sleep(gap);
    const body = envelopeMessage(reward, meta, { ...context, now: now() });
    let retryAfterMs = 0;
    for (const [targetIndex, target] of targets.entries()) {
      for (let attempt = 0; attempt <= retryLimit; attempt += 1) {
        if (attempt > 0) {
          stats.retries += 1;
          // 429/503 yanıtındaki bekleme süresine saygı duy; yoksa kısa üstel geri çekilme.
          const delay = Math.min(
            30_000,
            Math.max(retryAfterMs, Math.max(0, retryDelayMs) * 2 ** (attempt - 1)),
          );
          log(`zarf bildirimi yeniden denenecek (${target.channel}, ${attempt}. tekrar)`);
          if (delay > 0) await sleep(delay);
        }
        stats.attempts += 1;
        try {
          await sendTo(target, body);
          stats.sent += 1;
          stats.channels[target.channel].sent += 1;
          lastSentAt = now();
          if (targetIndex > 0) stats.fallbackSent += 1;
          log(
            `zarf bildirimi gönderildi: ${text(reward?.envelopeId, 80)} (${target.channel}` +
              `${targetIndex > 0 ? " · yedek" : ""})`,
          );
          return true;
        } catch (error) {
          retryAfterMs = Math.max(0, Number(error?.retryAfter) || 0);
          const message = redact(error instanceof Error ? error.message : error);
          stats.channels[target.channel].failed += 1;
          stats.lastError = `${target.channel}: ${message}`;
          stats.lastFailureAt = new Date(now()).toISOString();
          if (!retryable(error) || attempt >= retryLimit) break;
          log(`zarf bildirimi başarısız (${target.channel}): ${message}`);
        }
      }
      if (targetIndex < targets.length - 1) {
        log(`zarf bildirimi ${targets[targetIndex + 1].channel} kanalına yedeklenecek`);
      }
    }
    stats.failed += 1;
    log(`zarf bildirimi teslim edilemedi: ${stats.lastError || "bilinmeyen hata"}`);
    return false;
  };

  const pump = async () => {
    while (queue.length) {
      try {
        await deliver(queue.shift());
      } catch (error) {
        // Beklenmeyen bir hata kuyruğu kilitlemesin; teslimat başarısız sayılır.
        stats.failed += 1;
        stats.lastError = redact(error instanceof Error ? error.message : error);
        stats.lastFailureAt = new Date(now()).toISOString();
        log(`zarf bildirimi beklenmeyen hata: ${stats.lastError}`);
      }
    }
  };

  /** Yeni zarfı kuyruğa alır; tekrar/sınır/açılışı geçmiş zarf için false döner. */
  const offer = (reward, meta = {}) => {
    const envelopeId = text(reward?.envelopeId, 80);
    if (!envelopeId) return false;
    if (seen.has(envelopeId)) {
      stats.skipped += 1;
      return false;
    }
    seen.add(envelopeId);
    if (!targets.length) {
      stats.skipped += 1;
      return false;
    }
    const opensMs = Number(reward?.opensAt) * 1000;
    if (!Number.isFinite(opensMs) || opensMs <= now()) {
      stats.skipped += 1;
      return false;
    }
    if (stats.sent + queue.length >= maxPerRun) {
      stats.skipped += 1;
      return false;
    }
    queue.push({ reward, meta });
    chain = chain.then(pump);
    return true;
  };

  /** Kuyruk boşalana kadar bekler ve koşu sayaçlarını döner. */
  async function settle() {
    await chain.catch(() => null);
    return { ...stats, queued: queue.length, channels: { ...stats.channels } };
  }

  return { offer, settle };
}
