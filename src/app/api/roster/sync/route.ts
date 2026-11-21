import { NextResponse } from "next/server";
import { lastRosterSync, rosterUrl, syncRoster } from "@/server/roster-sync";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ ok: true, url: rosterUrl(), last: lastRosterSync() });
}

export async function POST() {
  const result = await syncRoster();
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}
