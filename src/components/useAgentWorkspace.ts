"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "./api";
import { agentSelection, scopedPath } from "./workspace-model";
import type { AgentsData, DashboardData, WorkspaceView } from "./types";
export default function useAgentWorkspace(view: WorkspaceView, reference?: string) {
  const [listing,setListing]=useState<AgentsData>({mode:"live",owner:"",agents:[]});
  const [data,setData]=useState<DashboardData|null>(null);
  const [loading,setLoading]=useState(true);
  const [loginRequired,setLoginRequired]=useState(false);
  const [error,setError]=useState("");
  const generation=useRef(0);
  const refresh=useCallback(async()=>{
    const current=++generation.current;
    try {
      const next=await api<AgentsData>("/api/owner/agents");
      const selected=agentSelection(next.agents,reference);
      const dashboard=(view==="agent" || view==="console" || view==="history") && selected
        ? await api<DashboardData>(scopedPath("/api/owner/dashboard",selected.id)) : null;
      if (generation.current!==current) return;
      setListing(next);setData(dashboard);setLoginRequired(false);setError("");
    } catch(failure) {
      if(generation.current!==current) return;
      if(failure instanceof ApiError && failure.status===401) {
        setLoginRequired(true);setData(null);setListing({mode:"live",owner:"",agents:[]});setError("");
      } else {setError(errorMessage(failure));setData(null);}
    } finally {if(generation.current===current)setLoading(false);}
  },[view,reference]);
  useEffect(()=>{setLoading(true);setData(null);void refresh();return()=>{generation.current++;};},[refresh]);
  const pending=data?.payments.some(payment=>["queued","evaluating","awaiting_finality","approved","executing"].includes(payment.status))??false;
  useEffect(()=>{
    if(!pending)return;
    const timer=setInterval(()=>void refresh(),10000);
    return()=>clearInterval(timer);
  },[pending,refresh]);
  return {listing,data,loading,loginRequired,error,setError,refresh};
}
