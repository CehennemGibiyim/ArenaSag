import Link from "next/link";
import { ArrowUpRight, RadioTower, Signal } from "lucide-react";
import { networkSnapshot } from "@/server/network";
import { countryName } from "@/lib/discovery-model";
import shapes from "@/lib/radar-geography.json";

/** Homepage preview reads only the database, never starts a scan or a paid request. */
export async function RadarSpotlight() {
  const d = await networkSnapshot(new URLSearchParams()).catch(()=>null);
  const regions = new Map(d?.countries.filter(c=>c.code).map(c=>[c.code,c.n]) ?? []);
  return <section className="relative mb-5 overflow-hidden rounded-2xl border border-emerald-300/20 bg-gradient-to-r from-[#172b24] via-[#11201e] to-[#10171a]">
    <div className="grid items-center sm:grid-cols-[1.1fr_1fr]">
      <div className="relative z-[1] p-5 md:p-6"><p className="flex items-center gap-2 text-[9px] font-bold tracking-[.17em] text-emerald-200"><RadioTower size={13}/> KEŞİF MERKEZİ</p>
        <h2 className="mt-2 text-[25px] font-semibold tracking-[-.04em] text-white">Canlı yayın ağı</h2><p className="mt-1 text-[12px] leading-relaxed text-emerald-50/55">Ülke etiketleri, doğrulanan odalar ve yaklaşan sandıklar.</p>
        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2">{[["Doğrulanmış oda",d?.total],["Dinleniyor",d ? d.states.listening ?? 0 : null],["Yeni oda / son tur",d?.last?.report?.newRooms]].map(([label,value])=><div key={label}><p className="text-[23px] font-semibold leading-none tracking-tight text-white tabular-nums">{value ?? "—"}</p><p className="mt-1 text-[9px] text-emerald-50/50">{label}</p></div>)}</div>
        <Link href="/sandik" className="mt-4 inline-flex items-center gap-2 text-[11px] font-semibold text-emerald-200 hover:text-white">Sandık radarını aç <ArrowUpRight size={13}/></Link>
      </div>
      <div className="relative hidden px-6 py-3 sm:block"><svg viewBox="0 0 360 160" className="mx-auto w-full max-w-[430px]" role="img" aria-label="Doğrulanan odaların kaynak bölgeleri"><defs><pattern id="arena-home-dots" x="0" y="0" width="3" height="3" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".72" fill="#667f73"/></pattern></defs>
        {shapes.map(s=><path key={s.code} d={s.d} fill={regions.has(s.code) ? "#335d4d" : "url(#arena-home-dots)"}/>)}
        {shapes.filter(s=>regions.has(s.code)).map(s=><g key={s.code}><title>{countryName(s.code)} · {regions.get(s.code)} oda</title><circle cx={s.x} cy={s.y} r="4" fill="#a6f3c9" opacity=".16"/><circle cx={s.x} cy={s.y} r="1.4" fill="#b0fad1"/></g>)}
        </svg><p className="mt-1 flex items-center justify-end gap-1.5 text-[9px] tracking-wide text-emerald-50/50"><Signal size={11}/>{d ? `${regions.size} kaynak bölgesi` : "Ağ verisi alınamadı"} · Örneklem</p>
      </div>
    </div>
  </section>;
}
