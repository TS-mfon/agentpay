import Dashboard from "@/components/Dashboard";
export const metadata = {title:"Agent treasury | AgentPay",description:"Manage this agent's mandate, vault, and owner controls."};
export default async function AgentPage({params}:{params:Promise<{id:string}>}){const {id}=await params;return <Dashboard view="agent" reference={id}/>;}
