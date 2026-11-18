import { NextResponse } from "next/server";
import { getUpdateStatus } from "@/server/update";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const force = new URL(request.url).searchParams.get("force") === "1";
  try {
    const status = await getUpdateStatus(force);
    return NextResponse.json(status, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Güncelleme denetlenemedi" }, { status: 503 });
  }
}
