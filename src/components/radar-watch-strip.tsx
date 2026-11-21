"use client";

import { useEffect, useState } from "react";
import { Radar as RadarIcon } from "lucide-react";
import type { RadarWatchState } from "@/lib/radar-watch";
import { formatNumber } from "@/lib/format";

/**
 * WebSocket zarf dinleme şeridi.
 *
 * Veriyi `/api/radar/watch` üzerinden doğrudan yayınlanan `arena-live.json`'ın
 * `watch`/`warnings` alanlarından okur; veritabanı senkronunu beklemez. Hem
 * sandık radarı sekmesinde hem radar sayfasında aynı bileşen kullanılır.
 */
export function RadarWatchStrip({ className = "" }: { className?: string }) {
  const [state, setState] = useState<RadarWatchState | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const response = await fetch("/api/radar/watch", { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = (await response.json()) as RadarWatchState;
        if (cancelled) return;
        setState({ watch: data.watch ?? null, warnings: data.warnings ?? [], error: data.error });
      } catch (error) {
        // Durum alınamazsa sessizce yutma: şerit nedeni gösterir.
        if (!cancelled) {
          setState({
            watch: null,
            warnings: [],
            error: error instanceof Error ? error.message : "radar verisi alınamadı",
          });
        }
      }
    };
    void pull();
    const timer = setInterval(() => void pull(), 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const watch = state?.watch ?? null;
  const quotaLabel = !watch
    ? ""
    : watch.rateLimited
      ? "imzalama kotası doldu"
      : watch.signedWithKey
        ? "anahtarlı imza"
        : "ücretsiz imza";
  const quotaTone = !watch
    ? "text-white/45"
    : watch.rateLimited
      ? "text-pink-200"
      : watch.signedWithKey
        ? "text-emerald-200"
        : "text-amber-200";

  return (
    <div className={`panel px-3.5 py-3 ${className}`.trim()}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-white/35">
          <RadarIcon size={12} className="text-cyan-200/70" /> WebSocket zarf dinleme
        </span>
        {watch ? (
          <span className="text-[11px] tabular-nums text-white/55">
            <b className="text-white">{watch.connected}/{watch.requested}</b> oda ·{" "}
            <b className="text-white">{formatNumber(watch.envelopes)}</b> zarf ·{" "}
            <span className={quotaTone}>{quotaLabel}</span>
          </span>
        ) : (
          <span className={state?.error ? "text-[11px] text-pink-200" : "text-[11px] text-white/40"}>
            {!state ? "veri okunuyor" : state.error ? "veri alınamadı" : "dinleme kaydı yok"}
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
