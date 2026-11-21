#!/usr/bin/env node
/**
 * Zarf bildirimi — yakalanan zarfı GitHub Actions içinden, panel senkronunu ve
 * Pages yayınını beklemeden Telegram/Discord'a iletir.
 *
 * Adres yalnızca ortam değişkeninden (GitHub secret) okunur:
 *   ARENA_TELEGRAM_BOT_TOKEN + ARENA_TELEGRAM_CHAT_ID
 *   ARENA_DISCORD_WEBHOOK_URL
 * Değer hiçbir dosyaya yazılmaz, konsola basılmaz; hata metinlerinde geçerse
 * maskelenir. Kanal tanımlı değilse sessizce yutulmaz: tek satır neden yazılır.
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
const SEND_TIMEOUT_MS = 8_000;

/** Bildirim kanalını yalnızca ortamdan seçer; tanımlı değilse null döner. */
export function notificationTarget(env = process.env) {
  const token = text(env.ARENA_TELEGRAM_BOT_TOKEN, 200);
  const chatId = text(env.ARENA_TELEGRAM_CHAT_ID, 64);
  if (token && chatId) return { channel: "telegram", token, chatId };
  const url = text(env.ARENA_DISCORD_WEBHOOK_URL, 500);
  if (url) return { channel: "discord", url };
  return null;
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
  fetchImpl = (...args) => fetch(...args),
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const target = notificationTarget(env);
  const seen = new Set();
  for (const id of known) {
    const envelopeId = text(id, 80);
    if (envelopeId) seen.add(envelopeId);
  }
  const queue = [];
  let chain = Promise.resolve();
  let sent = 0;
  let failed = 0;
  let skipped = 0;
  let lastSentAt = 0;

  if (!target) {
    log(
      "zarf bildirimi kapalı: ARENA_TELEGRAM_BOT_TOKEN/ARENA_TELEGRAM_CHAT_ID veya " +
        "ARENA_DISCORD_WEBHOOK_URL tanımlı değil",
    );
  }

  // Hata metni adresi/token'ı taşıyabilir; log'a yalnızca maskelenmiş hâli gider.
  const redact = (message) => {
    let clean = text(message, 200) || "hata";
    for (const secret of [target?.token, target?.url, target?.chatId]) {
      if (secret) clean = clean.split(secret).join("***");
    }
    return clean;
  };

  const send = async ({ reward, meta }) => {
    const gap = minGapMs - (now() - lastSentAt);
    if (gap > 0) await new Promise((resolve) => setTimeout(resolve, gap));
    const body = envelopeMessage(reward, meta, { ...context, now: now() });
    try {
      if (target.channel === "telegram") {
        const response = await fetchImpl(`https://api.telegram.org/bot${target.token}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: target.chatId, text: body, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.ok === false) {
          throw new Error(`HTTP ${response.status}${payload.description ? ` · ${payload.description}` : ""}`);
        }
      } else {
        const response = await fetchImpl(target.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Metindeki "@everyone" gibi diziler Discord'da bahsetmeye dönüşmesin.
          body: JSON.stringify({ content: body, allowed_mentions: { parse: [] } }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
      }
      lastSentAt = now();
      sent += 1;
      log(`zarf bildirimi gönderildi: ${text(reward?.envelopeId, 80)} (${target.channel})`);
    } catch (error) {
      failed += 1;
      log(`zarf bildirimi gönderilemedi (${target.channel}): ${redact(error instanceof Error ? error.message : error)}`);
    }
  };

  const pump = async () => {
    while (queue.length) await send(queue.shift());
  };

  /** Yeni zarfı kuyruğa alır; tekrar/sınır/açılışı geçmiş zarf için false döner. */
  const offer = (reward, meta = {}) => {
    const envelopeId = text(reward?.envelopeId, 80);
    if (!envelopeId) return false;
    if (seen.has(envelopeId)) {
      skipped += 1;
      return false;
    }
    seen.add(envelopeId);
    if (!target) {
      skipped += 1;
      return false;
    }
    const opensMs = Number(reward?.opensAt) * 1000;
    if (!Number.isFinite(opensMs) || opensMs <= now()) {
      skipped += 1;
      return false;
    }
    if (sent + queue.length >= maxPerRun) {
      skipped += 1;
      return false;
    }
    queue.push({ reward, meta });
    chain = chain.then(pump);
    return true;
  };

  /** Kuyruk boşalana kadar bekler ve koşu sayaçlarını döner. */
  async function settle() {
    await chain.catch(() => null);
    return { sent, failed, skipped, queued: queue.length };
  }

  return { offer, settle };
}
