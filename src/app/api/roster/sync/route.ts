import { NextResponse } from "next/server";
import { guardAdmin } from "@/server/api-guard";
import { lastRosterSync, rosterUrl, syncRoster } from "@/server/roster-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, url: rosterUrl(), last: lastRosterSync() });
}

export async function POST(request: Request) {
  const denied = await guardAdmin(request, { mutation: true });
  if (denied) return denied;
  const result = await syncRoster();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
