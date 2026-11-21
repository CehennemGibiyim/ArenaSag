"use client";

import { useEffect, useState } from "react";
import { Radar as RadarIcon } from "lucide-react";
import type { RadarWatch, RadarWatchSnapshot } from "@/lib/radar-watch";
import { formatNumber, timeAgo } from "@/lib/format";

// Yayın kadansı 10 dakika; 5 dakikalık yoklama taze kalırken yayın başına en
// fazla birkaç istek üretir. Sekmeye dönüşte ayrıca beklemeden tazelenir.
const REFRESH_MS = 5 * 60_000;

/**
 * Kota etiketi ve rengi tek yerde. Bekleme sürerken "kota doldu" denmez:
 * yeniden deneme anı geri sayılır, süre dolunca beklemenin bittiği söylenir.
 */
function quotaOf(watch: RadarWatch, now: number) {
  const untilMs = watch.cooldownUntil ? Date.parse(watch.cooldownUntil) : NaN;
  const left = Number.isFinite(untilMs) ? Math.max(0, Math.ceil((untilMs - now) / 1000)) : null;
  if (left !== null && left > 0) {
    return {
      label: `kota beklemesi · yeniden deneme ${left} sn`,
      compact: `yeniden deneme ${left} sn`,
      tone: watch.rateLimited ? "text-pink-200" : "text-amber-200",
    };
  }
  if (watch.rateLimited) {
    return { label: "kota doldu · yeniden deneme yok", compact: "kota doldu", tone: "text-pink-200" };
  }
  if (watch.cooldownWaits > 0) {
    return {
      label: `ücretsiz imza · ${watch.cooldownWaits} kez kota beklendi, yeniden denendi (${watch.cooldownSeconds} sn)`,
      compact: `${watch.cooldownWaits} kez kota beklemesi`,
      tone: "text-amber-200",
    };
  }
  if (watch.signedWithKey) return { label: "anahtarlı imza", compact: "anahtarlı imza", tone: "text-emerald-200" };
  return { label: "ücretsiz imza", compact: "ücretsiz imza", tone: "text-amber-200" };
}

/**
 * WebSocket zarf dinleme şeridi.
 *
 * Veriyi `/api/radar/watch` üzerinden doğrudan yayınlanan `arena-live.json`'ın
 * `watch`/`warnings` alanlarından okur; veritabanı senkronunu beklemez. Hem
 * sandık radarı sekmesinde hem radar sayfasında aynı bileşen kullanılır.
 */
export function RadarWatchStrip({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const [state, setState] = useState<RadarWatchSnapshot | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Kota beklemesi varsa geri sayım saniyelik, yoksa yaş etiketi dakikalık
  // tazelenir. Tek zamanlayıcı, iki ayrı interval'in çakışmasını önler.
  useEffect(() => {
    const intervalMs = state?.watch?.cooldownUntil ? 1_000 : 60_000;
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [state?.watch?.cooldownUntil]);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const response = await fetch("/api/radar/watch", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as RadarWatchSnapshot;
        if (!cancelled) setState(data);
      } catch (error) {
        if (cancelled) return;
        // Geçici bir hata son iyi sayıları silmesin: hata yalnızca nedeni ekler.
        setState((previous) => ({
          watch: previous?.watch ?? null,
          warnings: previous?.warnings ?? [],
          generatedAt: previous?.generatedAt ?? null,
          error: error instanceof Error ? error.message : "radar verisi alınamadı",
        }));
      }
    };
    void pull();
    const timer = setInterval(() => {
      // Gizli sekmede yoklama yapılmaz; sekmeye dönüşte hemen tazelenir.
      if (document.visibilityState === "visible") void pull();
    }, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void pull();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const watch = state?.watch ?? null;
  const quota = watch ? quotaOf(watch, now) : null;
  const generatedAt = state?.generatedAt ?? null;
  const generatedMs = generatedAt ? Date.parse(generatedAt) : NaN;
  // Yayın kadansı 10 dakika; 20 dakikayı geçen yaş bayat sayılır.
  const ageStale = Number.isFinite(generatedMs) && now - generatedMs > 20 * 60_000;
  const age = generatedAt ? (
    <span
      className={ageStale ? "text-amber-200/80" : "text-white/35"}
      title={`Son radar senkronu: ${new Date(generatedAt).toLocaleString("tr-TR")}`}
    >
      son tarama {timeAgo(generatedAt)}
    </span>
  ) : null;
  // Tam ve mini görünüm aynı sayıları/quota/yaşı paylaşır; yalnızca kota etiketi
  // ve boş durum metni kısalır.
  const summary = watch ? (
    <>
      <b className="text-white">{watch.connected}/{watch.requested}</b> oda ·{" "}
      <b className="text-white">{formatNumber(watch.envelopes)}</b> zarf
      {quota ? (
        <>
          {" · "}
          <span className={quota.tone} title={quota.label}>
            {compact ? quota.compact : quota.label}
          </span>
        </>
      ) : null}
      {age ? <> · {age}</> : null}
    </>
  ) : null;
  const emptyText = !state
    ? compact
      ? "okunuyor"
      : "veri okunuyor"
    : state.error
      ? compact
        ? "alınamadı"
        : "veri alınamadı"
      : compact
        ? "kayıt yok"
        : "dinleme kaydı yok";
  // Mini radar penceresi dar: tek satır sayı + ilk uyarı, aynı veriden.
  if (compact) {
    return (
      <div className={`rounded-lg border border-white/[0.09] bg-white/[0.03] px-2 py-1 ${className}`.trim()}>
        <div className="flex items-center justify-between gap-2 text-[9.5px] tabular-nums">
          <span className="inline-flex items-center gap-1 font-bold uppercase tracking-[0.12em] text-white/35">
            <RadarIcon size={10} className="text-cyan-200/70" /> WS zarf
          </span>
          {summary ? (
            <span className="text-white/55">{summary}</span>
          ) : (
            <span className={state?.error ? "text-pink-200" : "text-white/40"}>{emptyText}</span>
          )}
        </div>
        {state?.warnings[0] ? (
          <p className="mt-0.5 truncate text-[9px] text-amber-200/80" title={state.warnings.join(" · ")}>
            {state.warnings[0]}
          </p>
        ) : null}
        {state?.error ? <p className="mt-0.5 truncate text-[9px] text-pink-200">{state.error}</p> : null}
      </div>
    );
  }

  return (
    <div className={`panel px-3.5 py-3 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-white/35">
          <RadarIcon size={12} className="text-cyan-200/70" /> WebSocket zarf dinleme
        </span>
        {summary ? (
          <span className="text-[11px] tabular-nums text-white/55">{summary}</span>
        ) : (
          <span className={state?.error ? "text-[11px] text-pink-200" : "text-[11px] text-white/40"}>
            {emptyText}
          </span>
        )}
      </div>
      {state && (state.error || state.warnings.length) ? (
        <ul className="mt-2 space-y-1">
          {state.error ? (
            <li className="rounded-lg border border-pink-400/25 bg-pink-500/[0.08] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-pink-100">
              {state.error}
            </li>
          ) : null}
          {state.warnings.map((line) => (
            <li
              key={line}
              className="rounded-lg border border-amber-300/25 bg-amber-400/[0.07] px-2.5 py-1.5 text-[10.5px] leading-relaxed text-amber-100"
            >
              {line}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
