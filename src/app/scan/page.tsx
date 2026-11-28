import type { Metadata } from "next";
import ScanFeed from "@/scan/ScanFeed";
import ScanSearch from "@/scan/ScanSearch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AgentPay Scan | Payment requests",
  description: "Look up a payment request and follow its progress through GenLayer and Aevum.",
  robots: { index: false, follow: false },
};

export default function ScanPage() {
  const demo = process.env.AGENTPAY_MODE === "demo";
  return (
    <>
      <header className="scan-intro">
        <div>
          <h1>AgentPay Scan</h1>
          <p>Follow payment requests from GenLayer review to Aevum settlement.</p>
        </div>
        <span className="scan-network">{demo ? "Demo mode" : "Aevum Testnet"}</span>
      </header>
      <ScanSearch />
      {process.env.AGENTPAY_SCAN_FEED !== "false" && <ScanFeed />}
    </>
  );
}
