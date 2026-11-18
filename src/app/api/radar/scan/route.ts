import { NextResponse } from "next/server";
import { runScan, scannerDashboard, startScannerLoop, stopScannerLoop } from "@/server/scanner";
import { countryRegistry, eulerFeedEnabled } from "@/server/free-discovery";
import { cleanHandle, countryCode, countryName, obj } from "@/lib/discovery-model";
import { saveSettings } from "@/server/settings";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    if (new URL(request.url).searchParams.get("regions") === "list") {
      const r = await countryRegistry();
      return NextResponse.json({ regions: r.codes.map(code => ({ code, label: countryName(code) })).sort((a,b) => a.label.localeCompare(b.label,"tr")), total: r.codes.length,
        coverage: "regional-candidate-samples", source: "TikWM", exhaustive: false, state: r.state, detail: r.detail, eulerAvailable: eulerFeedEnabled() });
    }
    return NextResponse.json(await scannerDashboard(), { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Keşif durumu okunamadı." }, { status: 503 }); }
}
export async function POST(request: Request) {
  let body: Record<string,unknown>;
  try { body = obj(await request.json()); } catch { return NextResponse.json({ ok: false, error: "Geçersiz JSON." }, { status: 400 }); }
  try {
    if (body.action === "start" || body.action === "stop") {
      const enabled = body.action === "start";
      await saveSettings({ autoScan: enabled });
      if (enabled) startScannerLoop(); else stopScannerLoop();
      return NextResponse.json({ ok: true, ...(await scannerDashboard()) });
    }
    if (body.action && body.action !== "scan") return NextResponse.json({ ok: false, error: "Bilinmeyen işlem." }, { status: 400 });
    if (body.regions !== undefined && (!Array.isArray(body.regions) || body.regions.length > 260 || body.regions.some(x => !countryCode(x))))
      return NextResponse.json({ ok: false, error: "Geçerli iki harfli bölge kodları gerekli." }, { status: 400 });
    if (body.only !== undefined && (!Array.isArray(body.only) || body.only.length > 32 || body.only.some(x => !cleanHandle(x))))
      return NextResponse.json({ ok: false, error: "En fazla 32 geçerli hesap girilebilir." }, { status: 400 });
    const result = await runScan({ regions: Array.isArray(body.regions) ? body.regions.map(countryCode) : [], only: Array.isArray(body.only) ? body.only.map(cleanHandle) : [] });
    return NextResponse.json({ ok: true, result, regionsScanned: result.report.markets.filter(m => m.requests > 0).length,
      regionsCovered: "Kaynak örneklemi; tüm yayınların listesi değildir.", regionSummary: result.regionSummary,
      errors: result.errors, ...(await scannerDashboard()) });
  } catch { return NextResponse.json({ ok: false, error: "Keşif turu çalıştırılamadı." }, { status: 503 }); }
}
