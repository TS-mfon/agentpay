import Dashboard from "@/components/Dashboard";
export const metadata = {title:"Request history | AgentPay",description:"Inspect an agent's payment requests, decisions, and Aevum receipts."};
export default async function HistoryPage({searchParams}:{searchParams:Promise<{treasuryId?:string|string[];request?:string|string[]}>}){const {treasuryId,request}=await searchParams;return <Dashboard view="history" reference={Array.isArray(treasuryId)?treasuryId[0]:treasuryId} requestId={Array.isArray(request)?request[0]:request}/>;}
