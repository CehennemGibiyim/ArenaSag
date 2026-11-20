import Link from "next/link";
import { MonitorDown } from "lucide-react";
import { PackageCenter } from "@/components/package-center";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default function WindowsPage() {
  return (
    <div>
      <PageHeader
        eyebrow="Dağıtım · Windows"
        title="Windows kurulum paketi"
        description="GitHub'da üretilen Arena Radar kurulum paketi: salt okunur panel dahil, PostgreSQL gerektirmez; açılışta sürümü denetler ve GitHub'daki canlı sandık verisini çeker. Tam panel için zip paketi de indirilebilir."
        actions={
          <>
            <a href="https://github.com/CehennemGibiyim/ArenaSag/releases/latest/download/ArenaRadar-Setup.exe" className="btn btn-primary">
              <MonitorDown size={14} /> Arena Radar (.exe)
            </a>
            <a href="/api/packages/windows" className="btn">
              <MonitorDown size={14} /> Tam paket (.zip)
            </a>
            <Link href="/kutuphane" className="btn">
              Web kütüphanesi
            </Link>
          </>
        }
      />
      <PackageCenter />
    </div>
  );
}
