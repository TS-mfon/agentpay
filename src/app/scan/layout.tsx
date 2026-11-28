import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import "@/scan/scan.css";

export default function ScanLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="scan-shell">
      <header className="scan-header">
        <nav aria-label="Scan navigation" className="scan-container">
          <Link href="/" className="scan-brand" aria-label="AgentPay home">
            <Image src="/icon.svg" width={34} height={34} alt="" unoptimized />
            AgentPay
          </Link>
          <div className="scan-header-links">
            <Link href="/scan" className="scan-header-current">Scan</Link>
            <Link href="/agents">Owner workspace <ArrowUpRight size={16} aria-hidden="true" /></Link>
          </div>
        </nav>
      </header>
      <main className="scan-container scan-main">{children}</main>
    </div>
  );
}
