"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "./api";
import { agentSelection, scopedPath } from "./workspace-model";
import type { AgentsData, DashboardData, WorkspaceView } from "./types";

const emptyListing: AgentsData = {mode:"live",owner:"",agents:[]};

export default function useAgentWorkspace(view: WorkspaceView, reference?: string) {
  const [listing,setListing]=useState<AgentsData>(emptyListing);
  const [data,setData]=useState<DashboardData|null>(null);
  const [loading,setLoading]=useState(true);
  const [loginRequired,setLoginRequired]=useState(false);
  const [error,setError]=useState("");
  const generation=useRef(0);
  const refresh=useCallback(async(resetOwner=false)=>{
    const current=++generation.current;
    if(resetOwner) {
      setLoading(true);setListing(emptyListing);setData(null);setLoginRequired(false);setError("");
    }
    try {
      const next=await api<AgentsData>("/api/owner/agents");
      if (generation.current!==current) return;
      setListing(next);setLoginRequired(false);setError("");
      const selected=agentSelection(next.agents,reference);
      setData(previous=>previous?.owner===next.owner && previous.treasury.id===selected?.id ? previous : null);
      const dashboard=(view==="agent" || view==="console" || view==="history") && selected
        ? await api<DashboardData>(scopedPath("/api/owner/dashboard",selected.id)) : null;
      if (generation.current!==current) return;
      setData(dashboard);
    } catch(failure) {
      if(generation.current!==current) return;
      if(failure instanceof ApiError && failure.status===401) {
        setLoginRequired(true);setData(null);setListing(emptyListing);setError("");
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
