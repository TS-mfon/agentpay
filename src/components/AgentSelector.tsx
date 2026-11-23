import Link from "next/link";
import { useRouter } from "next/navigation";
import { shorten } from "./view-model";
import type { AgentCard } from "./types";
export default function AgentSelector({agents,selectedId,page}:{agents:AgentCard[];selectedId?:string;page:"console"|"history"}){
 const router=useRouter();
 return <div className="agent-selector"><div className="agent-selector-control"><label htmlFor="selected-agent">Agent</label><select id="selected-agent" value={selectedId??""} onChange={event=>router.push(`/${page}?treasuryId=${encodeURIComponent(event.target.value)}`)}><option value="" disabled>Choose an agent</option>{agents.map(agent=><option key={agent.id} value={agent.id}>{agent.agentName} — {shorten(agent.id)}</option>)}</select></div>{selectedId?<Link className="text-button" href={`/agent/${selectedId}`}>Open agent treasury</Link>:<Link className="text-button" href="/setup">Create another agent</Link>}</div>;
}
