import Link from "next/link";
import { RadarConsole } from "@/components/radar-console";
import { Network } from "lucide-react";
import { LiveChestFeed } from "@/components/live-chest-feed";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function RadarPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Radar · Canlı ödüller"
        title="Canlı ödül radarı"
        description="Keşif ve canlı yayın dinleme tamamen otomatiktir: sistem açık yayınları kendisi bulur, dinleme sırasına ekler ve sandıkları jeton/kontenjan/açılış zamanıyla buraya düşürür. Süresi geçen sandıklar listeden kaldırılır."
        actions={
          <>
            <Link href="/sandik" className="btn"><Network size={14}/> Yayın ağı ve ülke raporu</Link>
            <Link href="/canli" className="btn btn-primary">
              Canlı stüdyo
            </Link>
          </>
        }
      />
      <LiveChestFeed />
      <RadarConsole />
    </div>
  );
}
