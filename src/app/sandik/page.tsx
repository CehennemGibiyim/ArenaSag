import { ChestRadar } from "@/components/chest-radar";
import { NetworkRadar } from "@/components/network-radar";
export const dynamic = "force-dynamic";
export default async function ChestRadarPage({ searchParams }: { searchParams: Promise<{ mini?: string; q?: string }> }) {
  const { mini, q } = await searchParams;
  return mini === "1" ? <ChestRadar mini initialQuery={q ?? ""}/> : <NetworkRadar initialQuery={q ?? ""}/>;
}
