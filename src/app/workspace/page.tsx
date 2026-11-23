import type { Metadata } from "next";
import Dashboard from "@/components/Dashboard";
export const metadata: Metadata = {
  title: "Workspace | AgentPay",
  description: "Create your agent treasury, set spending permissions and manage real Aevum payments.",
};
export default function WorkspacePage() { return <Dashboard />; }
