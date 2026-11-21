import { NextResponse } from "next/server";
import { readRadarWatch } from "@/server/radar-sync";

export const dynamic = "force-dynamic";

/** Yayınlanan `arena-live.json`'dan WS dinleme durumunu okur; veritabanı gerektirmez. */
export async function GET() {
  const state = await readRadarWatch();
  return NextResponse.json(state, { headers: { "cache-control": "no-store" } });
}
