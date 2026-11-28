import type { Metadata } from "next";
import { scanIdPattern } from "@/core/scan-types";
import ScanDetail from "@/scan/ScanDetail";

export const metadata: Metadata = {
  title: "Payment request | AgentPay Scan",
  robots: { index: false, follow: false },
};

export default async function ScanRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const requestId = scanIdPattern.test(id) ? id.toLowerCase() : null;
  return <ScanDetail key={requestId} id={requestId} demo={process.env.AGENTPAY_MODE === "demo"} />;
}
