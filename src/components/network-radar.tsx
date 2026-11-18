"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, AudioLines, Box, CheckCheck, ChevronLeft, ChevronRight, CircleHelp, Compass, Database, Fingerprint, Layers3, ListFilter, Loader2, MapPin, Network, Radio, RadioTower, ScanLine, Search, ShieldCheck, Signal, SlidersHorizontal, Timer, Waves } from "lucide-react";
import { SOURCE_LABELS, STATE_LABELS, countryName, type DiscoveryReport, type QuotaSample } from "@/lib/discovery-model";
import shapes from "@/lib/radar-geography.json";
import { ChestRadar } from "@/components/chest-radar";
import "./network-radar.css";

type Room = { id: number; username: string; nickname: string; title: string; roomId: string; viewers: number; source: string; region: string;
  regionBasis: string; lastSeenAt: string; jobStatus: string; connectedAt: string | null; nextAttemptAt: string | null };
type Snapshot = { quota: { state: string; detail: string; sample: QuotaSample | null; nextAt: string } | null; rooms: Room[]; countries: { code: string; n: number }[]; states: Record<string, number>; last: { id: number; finishedAt: string; report: DiscoveryReport } | null;
  total: number; filtered: number; pages: number; page: number; supported: string[]; listenerLimit: number; listenToAll: boolean;
  autoScan: boolean; running: boolean; eulerAvailable: boolean; gate: { nextAt: string; reason: string } | null; at: string };
const num = (v: number | undefined) => v === undefined ? "—" : v.toLocaleString("tr-TR");
const atTime = (d: string | null | undefined) => d ? new Date(d).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }) : "—";
const basis: Record<string, string> = { market: "Keşif pazarı", room: "Oda sahibi etiketi", directory: "Dizin etiketi", sample: "Açık liste etiketi", unknown: "Ülke bilgisi yok" };
const SOURCE_INFO: Record<string, { title: string; sub: string; link?: string }> = {
  directory: { title: "Yayıncı dizini", sub: "Geçmiş yayıncılar · canlılık yeniden doğrulanır", link: "https://github.com/CehennemGibiyim/TikTok/tree/main/site/firsat/data" },
  tikwm: { title: "TikWM bölgeleri", sub: "Popüler video hesapları · canlı yayın listesi değil", link: "https://github.com/AndreyQq/Tiktok-Video-No-Watermark" },
  "public-sample": { title: "Tik.Tools", sub: "Açık yayın örneklemi · en çok 10 aday / 5 dk", link: "https://tik.tools/docs" },
  cohost: { title: "Ortak yayınlar", sub: "Yalnızca yayındaki diğer sunucular · izleyiciler hariç" },
  saved: { title: "Kayıtlı havuz", sub: "Sabitlenenler, izleme listesi ve yakın zamanda doğrulananlar" },
  euler: { title: "EulerStream", sub: "İsteğe bağlı bölge örneklemi · tam katalog değil", link: "https://www.eulerstream.com/docs/api/tiktok-live" },
};
const tabItems = [{ id: "network", label: "Yayın ağı", Icon: Network }, { id: "rewards", label: "Sandıklar ve çantalar", Icon: Box }, { id: "report", label: "Keşif raporu", Icon: Layers3 }] as const;
type Tab = typeof tabItems[number]["id"];
const avatarColors = ["#71dac4", "#a7adf5", "#f2ae83", "#91c2ed", "#e0a2c6"];

function Geography({ countries, selected, select }: { countries: Snapshot["countries"]; selected: string; select: (v:string) => void }) {
  const active = new Map(countries.filter(c=>c.code).map(c=>[c.code,c.n]));
  return <div className="nr-map">
    <div className="nr-map-top"><span><span className="nr-dash" /> BÖLGE GÖRÜNÜMÜ</span><span>GEO / 01</span></div>
    <svg viewBox="0 0 360 160" role="img" aria-label={`Doğrulanmış odalar arasında ${active.size} kaynak bölgesi`}>
      <defs><pattern id="nr-dot" x="0" y="0" width="3.6" height="3.6" patternUnits="userSpaceOnUse"><circle cx="1.8" cy="1.8" r="0.77" fill="#536368" /></pattern></defs>
      <g fill="url(#nr-dot)" stroke="rgba(132,161,166,.23)" strokeWidth="0.22">{shapes.map(s => <path key={s.code} d={s.d} fill={active.has(s.code) ? "#335c53" : undefined} />)}</g>
      {shapes.filter(s=>active.has(s.code)).map(s=><g key={s.code} role="button" tabIndex={0} aria-label={`${countryName(s.code)}: ${active.get(s.code)} oda`} onClick={()=>select(selected === s.code ? "" : s.code)} onKeyDown={e=>{ if(e.key === "Enter" || e.key === " ") { e.preventDefault(); select(s.code); } }} style={{cursor:"pointer"}}>
        <title>{countryName(s.code)} · {active.get(s.code)} oda</title><circle cx={s.x} cy={s.y} r="4.7" fill="#7bf2c7" opacity=".14" /><circle cx={s.x} cy={s.y} r={selected === s.code ? "2.5" : "1.5"} fill="#a6f7cf" /></g>)}
    </svg>
    <div className="nr-map-caption"><i /> {active.size} kaynak bölgesi <span>Konum değil, kaynak etiketi</span></div>
  </div>;
}

function Report({ last }: { last: Snapshot["last"] }) {
  if (!last) return <div className="nr-empty"><Compass /><h3>İlk tur henüz tamamlanmadı</h3><p>Kaynaklar yanıt verdikçe doğrulama sonuçları burada birikecek.</p></div>;
  const r = last.report;
  return <div className="nr-card nr-report">
    <div className="nr-section-head"><div><span className="nr-kicker">KAYNAK DENETİMİ</span><h2>Keşif raporu</h2></div><span className="nr-tag">Tur #{last.id}</span></div>
    <div className="nr-report-roll"><span><b>{num(r.checked)}</b> kontrol</span><span><b>{num(r.verified)}</b> canlı</span><span><b>{num(r.newRooms)}</b> yeni oda</span><span><b>{num(r.firstHosts)}</b> ilk kez canlı görülen hesap</span><span><b>{num(r.repeatedRooms)}</b> yeniden doğrulama</span><span><b>{num(r.offline)}</b> çevrimdışı</span><span><b>{num(r.unknown)}</b> belirsiz</span></div>
    <div className="nr-scroll"><table className="nr-table"><thead><tr>{["Kaynak", "Aday", "Kontrol", "Canlı", "Yeni", "İstek / önbellek", "Yanıt"].map(t=><th key={t}>{t}</th>)}</tr></thead><tbody>{r.sources.map(s=><tr key={s.id}><td><b>{SOURCE_INFO[s.id]?.title ?? s.id}</b><small>{s.detail || SOURCE_INFO[s.id]?.sub}</small></td><td>{s.candidates}</td><td>{s.checked}</td><td>{s.verified}</td><td>{s.newRooms}</td><td>{s.requests} / {s.cached}</td><td>{STATE_LABELS[s.state] ?? s.state}</td></tr>)}</tbody></table></div>
    <div className="nr-report-foot"><p>Hesaplar kaynaklar arasında birleştirilir. “Yeni”, veritabanında ilk kez görülen oda kimliğidir; aynı hesabın yeni yayını farklı bir oda olabilir.</p>
      <p>{num(r.supported)} desteklenen pazar · Ülke listesi için {r.registryRequests} istek · Euler bölge feed’ine {r.eulerRequests} istek · Tur bütçesi dışında kalan {r.deferred} aday.</p>
      {r.markets.length > 0 && <div className="nr-markets">{r.markets.map(m=><span key={m.region}>{m.region} · {m.candidates} aday · {m.cached ? "önbellek" : `${m.requests} istek`} · {STATE_LABELS[m.state]}{m.detail ? ` (${m.detail})` : ""}</span>)}</div>}
      {r.errors.length > 0 && <p role="alert">Tur uyarısı: {r.errors.join(" · ")}</p>}
    </div>
  </div>;
}
export function NetworkRadar({ initialQuery = "" }: { initialQuery?: string }) {
  const [tab,setTab] = useState<Tab>(initialQuery ? "rewards" : "network");
  const [data,setData] = useState<Snapshot | null>(null), [query,setQuery] = useState(""), [search,setSearch] = useState("");
  const [region,setRegion] = useState(""), [status,setStatus] = useState(""), [page,setPage] = useState(1);
  const [busy,setBusy] = useState(false), [message,setMessage] = useState(""), [error,setError] = useState(""), [epoch,setEpoch] = useState(0);
  const [sourcesOpen,setSourcesOpen] = useState(false);
  const lock = useRef(false);
  useEffect(()=>{ const t=setTimeout(()=>{setSearch(query.trim());setPage(1);},240);return()=>clearTimeout(t); },[query]);
  useEffect(()=>{
    const ctrl = new AbortController(); let loading = false;
    const load = async () => { if (loading) return; loading=true;
      try { const p=new URLSearchParams({ q:search, region, state:status, page:String(page) });
        const res=await fetch(`/api/radar/network?${p}`,{cache:"no-store", signal:ctrl.signal});
        if(!res.ok) throw new Error("Ağ durumu alınamadı. Son başarılı ölçüm korunuyor.");
        const json=await res.json() as Snapshot;
        if (!ctrl.signal.aborted) { setData(json); setError(""); }
      } catch(e) { if(!ctrl.signal.aborted) setError((e as Error).message); } finally { loading=false; } };
    void load();const t=setInterval(()=>void load(),8000); return()=>{clearInterval(t);ctrl.abort();};
  },[region,status,search,page,epoch]);
  const selectRegion=(v:string)=>{setRegion(v);setPage(1);};
  const scan = async () => {
    if(lock.current) return;lock.current=true;setBusy(true);setMessage("");
    try { const res = await fetch("/api/radar/scan",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"scan",regions:region && region!=="unknown" ? [region] : []})});
      const j=await res.json() as {ok?:boolean;error?:string;result?:{source:string;error:string;report:DiscoveryReport}};
      if(!res.ok || !j.ok || !j.result) throw new Error(j.error || "Tur başlatılamadı.");
      const r=j.result.report;setMessage(j.result.source === "busy" ? j.result.error : `${r.checked} hesap kontrol edildi. ${r.newRooms} yeni oda (${r.firstHosts ?? 0} yeni hesap), ${r.repeatedRooms} yeniden doğrulama. Ayrıntılar Keşif raporu’nda.`);
    } catch(e) { setMessage((e as Error).message); } finally { setBusy(false);lock.current=false;setEpoch(i=>i+1); }
  };
  const listening=data?.states.listening ?? 0, queued=data?.states.queued ?? 0, retry=data?.states.retry ?? 0, connecting=data?.states.connecting ?? 0;
  const options = [...new Set([...(data?.supported ?? []),...(data?.countries ?? []).map(c=>c.code).filter(Boolean)])].sort((a,b)=>countryName(a).localeCompare(countryName(b),"tr"));
  const codeCounts = new Map(data?.countries.map(c=>[c.code,c.n]) ?? []);
  const last=data?.last;
  return <div className="nr-root">
    <header className="nr-header"><div><div className="nr-kicker"><span className="nr-dash"/> ARENA INTELLIGENCE <span className="nr-slash">/</span> KEŞİF MERKEZİ</div><h1>Sandık radarı<span>.</span></h1><p>Doğrulanmış yayınlar, bağlantı durumları ve yaklaşan ödüller.</p></div>
      <div className="nr-head-actions"><span className="nr-auto"><i className={data?.autoScan && !error ? "on" : ""}/>{!data ? "Durum okunuyor" : error ? "Veri gecikti" : data.autoScan ? "Otomatik keşif açık" : "Otomatik keşif kapalı"}</span>
        <button className="nr-primary" onClick={()=>void scan()} disabled={busy || data?.running || region==="unknown"}>{busy || data?.running ? <Loader2 size={15} className="animate-spin"/> : <ScanLine size={15}/>} {busy || data?.running ? "Tur sürüyor" : region && region!=="unknown" ? `${region} örneklemini tara` : "Şimdi tara"}</button></div>
    </header>
    <nav className="nr-tabs" aria-label="Radar görünümleri">{tabItems.map(({id,Icon,label})=><button aria-pressed={tab===id} key={id} className={tab===id?"chosen":""} onClick={()=>setTab(id)}><Icon size={15}/>{label}</button>)}<span className="nr-clock"><Timer size={12}/> Son tur {atTime(last?.finishedAt)} TSİ</span></nav>
    {(error||message) && <div className="nr-notice" role="status"><CircleHelp size={14}/><span>{error||message}</span><button onClick={()=>error ? setEpoch(i=>i+1) : setMessage("")}>{error?"Yenile":"Kapat"}</button></div>}
    {tab==="rewards" ? <ChestRadar initialQuery={initialQuery}/> : tab==="report" ? <><Report last={last ?? null}/><p className="nr-fineprint">Ücretli bölge feed’i {data?.eulerAvailable ? "sunucu yapılandırmasında açık" : "kapalı"}. Bir bölgenin sorgulanması, tüm canlı yayınlarının bulunduğu anlamına gelmez.</p></> : <>
      <section className="nr-hero"><div className="nr-hero-copy"><div className="nr-kicker"><RadioTower size={13}/> YAYIN TELEMETRİSİ</div><h2>Canlı yayın ağı</h2><p>Dizini, bölgesel adayları ve açık yayın listesini tek ağda izleyin. Sadece canlılığı doğrulanan odalar görünür.</p>
        <div className="nr-hero-meta"><span><ShieldCheck size={13}/> Doğrulamalı</span><span><Layers3 size={13}/> {data?.eulerAvailable ? "Ek feed açık" : "Ücretsiz kaynaklar"}</span></div></div>
        <Geography countries={data?.countries ?? []} selected={region} select={selectRegion}/></section>
      <section className="nr-metrics" aria-label="Gerçek zamanlı oda sayıları">{[
        { label:"Doğrulanmış oda", value:data?.total, note:"Güncel yayın havuzu", Icon:Radio, tone:"mint" },
        { label:"Dinleniyor", value:data ? listening : undefined, note:`${connecting} bağlanıyor · ${data?.listenerLimit ?? "—"} yerel tavan`, Icon:AudioLines, tone:"blue" },
        { label:"Bekleyen oda", value:data ? queued+retry : undefined, note:`${queued} sırada · ${retry} yeniden deneme`, Icon:Layers3, tone:"amber" },
        { label:"Yeni oda", value:last?.report.newRooms, note:`Son tur · ${last?.report.repeatedRooms ?? "—"} yeniden görüldü`, Icon:Fingerprint, tone:"violet" },
      ].map(({label,value,note,Icon,tone})=><div key={label} className={`nr-metric ${tone}`}><span className="nr-metric-label">{label}<Icon size={16}/></span><strong>{num(value)}</strong><small>{note}</small></div>)}</section>
      <section className="nr-card"><div className="nr-section-head"><div><span className="nr-kicker"><span className="nr-dash"/> ODA DİZİNİ</span><h2>Doğrulanmış canlı yayınlar</h2></div><span className="nr-tag"><Signal size={12}/>{data ? `${num(data.total)} oda` : "Ölçülüyor"}</span></div>
        <div className="nr-controls"><label className="nr-search"><Search size={14}/><input aria-label="Yayıncı ara" placeholder="Yayıncı ara…" value={query} onChange={e=>setQuery(e.target.value)}/></label><label className="nr-select"><MapPin size={13}/><select aria-label="Kaynak bölgesini filtrele" value={region} onChange={e=>selectRegion(e.target.value)}><option value="">Tüm bölgeler</option><option value="unknown">Bölge bilinmiyor</option>{options.map(c=><option key={c} value={c}>{countryName(c)} ({c}){codeCounts.get(c)?` · ${codeCounts.get(c)}`:""}</option>)}</select></label><label className="nr-select"><ListFilter size={14}/><select aria-label="Bağlantı durumu" value={status} onChange={e=>{setStatus(e.target.value);setPage(1);}}><option value="">Tüm durumlar</option>{["listening","connecting","queued","retry","verified"].map(k=><option key={k} value={k}>{STATE_LABELS[k]}</option>)}</select></label></div>
        {data?.rooms.length ? <div className="nr-scroll"><table className="nr-table"><thead><tr><th>Yayıncı</th><th>Kaynak bölgesi</th><th>Dinleme durumu</th><th>İzleyici</th><th>Doğrulama</th><th><span className="sr-only">Yayın bağlantısı</span></th></tr></thead><tbody>{data.rooms.map(room=>{const color=avatarColors[room.id%avatarColors.length]; return <tr key={room.roomId}><td><div className="nr-host"><span className="nr-avatar" style={{color, background:`${color}14`,borderColor:`${color}35`}}>{room.username.replace(/^[_\.]+/,"").slice(0,2).toUpperCase()}</span><div><a href={`https://www.tiktok.com/@${room.username}/live`} target="_blank" rel="noreferrer">@{room.username}</a><small>{SOURCE_LABELS[room.source] ?? room.source} · {room.roomId}</small></div></div></td><td><span className="nr-country">{room.region ? countryName(room.region) : "Bilinmiyor"}</span><small>{basis[room.regionBasis] ?? "Kaynak etiketi"}</small></td><td><span className={`nr-state ${room.jobStatus}`}><i/>{STATE_LABELS[room.jobStatus] ?? "Doğrulandı"}</span>{room.jobStatus==="retry" && <small>En erken {atTime(room.nextAttemptAt)}</small>}</td><td className="nr-count">{num(room.viewers)}</td><td className="nr-time">{atTime(room.lastSeenAt)}</td><td><a className="nr-out" aria-label={`@${room.username} yayınını aç`} href={`https://www.tiktok.com/@${room.username}/live`} target="_blank" rel="noreferrer"><ArrowUpRight size={15}/></a></td></tr>;})}</tbody></table></div> : <div className="nr-empty">{!data && !error ? <Loader2 className="animate-spin"/> : <Radio/>}<h3>{!data ? error ? "Ağ durumu bilinmiyor" : "Ağ durumu okunuyor" : "Bu görünümde doğrulanmış oda yok"}</h3><p>{region||query||status ? "Filtreleri kaldırabilir veya sonraki doğrulama turunu bekleyebilirsin." : "Bir adayın bulunması, canlı olduğu anlamına gelmez. Doğrulama sonuçları otomatik gelir."}</p>{(region||query||status) && <button className="nr-link" onClick={()=>{setQuery("");setStatus("");selectRegion("");}}>Filtreleri kaldır <ArrowRight size={12}/></button>}</div>}
        <div className="nr-bottom"><span><CheckCheck size={13}/> {num(data?.filtered)} eşleşme · 30 dk doğrulama penceresi</span><div><button aria-label="Önceki sayfa" disabled={!data||data.page<=1} onClick={()=>setPage((data?.page??1)-1)}><ChevronLeft size={15}/></button><span>{data?.page??1} / {data?.pages??1}</span><button aria-label="Sonraki sayfa" disabled={!data||data.page>=data.pages} onClick={()=>setPage((data?.page??1)+1)}><ChevronRight size={15}/></button></div></div>
      </section>
      <section className="nr-info"><div className="nr-info-icon"><Waves size={19}/></div><div><h3>Dinleme kapasitesi</h3><p>{data?.listenToAll ? "Tüm doğrulanmış odalar hedeflenir." : "Elle ayarlanan bağlantı tavanı kullanılıyor."} Soketler kota ve yerel kapasite elverdikçe açılır. Sıradaki odalar henüz dinlenmiyor.</p>{data?.gate && <small>{data.gate.reason} · Sonraki deneme en erken {atTime(data.gate.nextAt)} TSİ.</small>}</div><Link href="/ayarlar" aria-label="Dinleme ayarları"><SlidersHorizontal size={15}/></Link></section>
      {data?.quota && <details className="nr-quota"><summary><Timer size={13}/> İmzalama isteği bütçesi <span>Son ölçüm</span></summary>
        {data.quota.sample ? <p>{data.quota.sample.windows.map(w=>`${({ minute:"Dakika",hour:"Saat",day:"Gün" })[w.period]}: ${w.remaining}/${w.max} istek kaldı`).join(" · ")} · {atTime(new Date(data.quota.sample.at).toISOString())} TSİ. Bu sayılar açık soket kontenjanı değildir.</p> : <p>{data.quota.detail || "Sağlayıcıdan bütçe bilgisi gelmedi."} Yerel sınırlar geçerlidir.</p>}
      </details>}
      <section className="nr-accordion"><button aria-expanded={sourcesOpen} onClick={()=>setSourcesOpen(v=>!v)}><Database size={15}/> Kaynaklar ve kapsam <span>{sourcesOpen?"Gizle":"İncele"} <ChevronRight size={13}/></span></button>{sourcesOpen && <div className="nr-source-list">{Object.entries(SOURCE_INFO).filter(([k])=>k!=="euler" || data?.eulerAvailable).map(([k,s])=><div key={k}><strong>{s.title}</strong><p>{s.sub}</p>{s.link && <a href={s.link} target="_blank" rel="noreferrer">Kaynak <ArrowUpRight size={11}/></a>}</div>)}<p className="nr-fineprint">Desteklenen bölgeler dönüşümlü örneklenir. Ülke etiketi yayıncının fiziksel konumunu veya o ülkedeki tüm yayınları göstermez. Ücretsiz, eksiksiz bir dünya yayın kataloğu yoktur.</p></div>}</section>
    </>}
  </div>;
}
