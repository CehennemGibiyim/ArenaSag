import { NextResponse } from "next/server";
import { guardAdmin } from "@/server/api-guard";
import { lastRadarSync, radarSnapshotUrl, syncRadar } from "@/server/radar-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, url: radarSnapshotUrl(), last: lastRadarSync() });
}

export async function POST(request: Request) {
  const denied = await guardAdmin(request, { mutation: true });
  if (denied) return denied;
  const result = await syncRadar();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
