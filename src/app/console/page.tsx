import Dashboard from "@/components/Dashboard";
export const metadata = {title:"Payment console | AgentPay",description:"Request a governed payment using an agent's approved recipients and spending mandate."};
export default async function ConsolePage({searchParams}:{searchParams:Promise<{treasuryId?:string|string[]}>}){const {treasuryId}=await searchParams;return <Dashboard view="console" reference={Array.isArray(treasuryId)?treasuryId[0]:treasuryId}/>;}
