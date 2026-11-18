import { NextResponse } from "next/server";
import { networkSnapshot } from "@/server/network";
import { countryCode } from "@/lib/discovery-model";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const region = params.get("region"), state = params.get("state");
  if ((region && region !== "unknown" && !countryCode(region)) || (state && !["queued","connecting","listening","retry","verified"].includes(state)))
    return NextResponse.json({ error: "Geçersiz filtre." }, { status: 400 });
  try { return NextResponse.json(await networkSnapshot(params), { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Ağ durumu okunamadı. Sonuçlar şu anda doğrulanamıyor." }, { status: 503 }); }
}
