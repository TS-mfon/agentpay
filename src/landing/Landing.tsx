"use client";
import { useEffect, useRef, useState } from "react";
import { Arrow, BrandMark, PixelIcon, ServiceArt, services, VaultArt } from "./art";
import { initStory } from "./story-controller";
import "./landing.css";
const headline = "Agents in Motion";
const skySource = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261118_061434_a222c9d2-715b-44b7-873f-0548d1624211.png";
export default function Landing() {
  const root = useRef<HTMLDivElement>(null);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    return initStory(root.current, paused);
  }, [paused]);
  return <div ref={root} className="ap-landing">
    <a className="skip-link" href="/workspace">Skip story and open workspace</a>
    <nav className="ap-nav" aria-label="Main navigation">
      <a className="ap-brand" href="/" aria-label="AgentPay home"><BrandMark/><span>AgentPay</span></a>
      <div className="ap-nav-links"><a href="#how-it-works">How it works</a><a href="#your-control">Your control</a><a href="/scan">Scan</a><a href="/docs">Documentation</a></div>
      <a href="/agents" className="ap-button">Open workspace <Arrow/></a>
    </nav>
    <main>
      <section id="story" className="ap-story" aria-label="AgentPay payment infrastructure">
        <header className="ap-hero">
          <p className="ap-intro-label">Payment infrastructure for AI agents</p>
          <h1 aria-label={headline} className="ap-headline">
            <span className="ap-headline-letters" aria-hidden="true">{[...headline].map((c,i)=><span key={i} className="ap-letter" style={{ "--letter-i": i } as React.CSSProperties}>{c === " " ? "\u00a0" : c}</span>)}</span>
            <span className="ap-headline-icons" aria-hidden="true">{Array.from({length:7},(_,i)=><span key={i} className="ap-pixel"><PixelIcon index={i}/></span>)}</span>
          </h1>
          <span className="ap-flying-plane" aria-hidden="true"><PixelIcon index={0}/></span>
          <p className="ap-hero-copy">Give your agents a budget.<br/>Let them get to work.</p>
          <div className="ap-hero-actions"><a href="/setup" className="ap-button">Set up your agent <Arrow/></a><a className="ap-text-link" href="/docs#quickstart">Read the agent guide</a></div>
          <span className="ap-scroll-hint">Scroll to follow a payment <span>↓</span></span>
        </header>
        <div className="ap-stage">
          <div id="how-it-works" className="ap-process">
            <h2><span>From</span> a request <i className="ap-process-chip" aria-hidden="true"><PixelIcon index={4}/></i><span>to</span> a receipt.<br/>Payments <span>with</span> purpose.</h2>
            <p>Your agent requests. GenLayer evaluates.<br className="ap-mobile-break"/> QDay Aevum settles.</p>
            <a href="/docs#lifecycle" className="ap-button">Explore the payment flow <Arrow/></a>
          </div>
          <div className="ap-cards" aria-hidden="true">{services.map(([name,description,color],i)=><div key={name} className="ap-card" style={{ "--card-color": color } as React.CSSProperties}><div className="ap-card-top"><span>AgentPay</span><span>↗</span></div><ServiceArt index={i}/><strong>{name}</strong><span className="ap-card-description">{description}</span></div>)}</div>
          <section id="your-control" className="ap-sky" aria-label="Owner-controlled agent treasury">
            <div className="ap-sky-plate" style={{backgroundImage:`url(${skySource})`}}/>
            <video className="ap-sky-video" muted loop playsInline preload="none" aria-hidden="true"/>
            <div className="ap-sky-top"><h2><span>Independent</span> agents.<br/>Defined authority.</h2><p>Purpose evaluated by GenLayer.</p></div>
            <div className="ap-vault"><VaultArt/></div>
            <div className="ap-sky-bottom"><h2><span>Your</span> funds.<br/><span>Your</span> control.</h2><p>Budgets enforced on QDay Aevum.<br/>Pause, revoke, or withdraw unused funds.</p></div>
          </section>
          <div className="ap-blackout"/>
        </div>
      </section>
      <section id="manifesto" className="ap-manifesto" aria-label="Financial freedom with boundaries">
        <div className="ap-manifesto-stage"><div className="ap-manifesto-track">
          <div className="ap-manifesto-intro ap-manifesto-item"><span className="ap-sticker ap-sticker-peach">Agent-native</span><span className="ap-sticker ap-sticker-blue">Owner-controlled</span><p><span>Useful work.</span><br/>Bounded authority.</p></div>
          <span className="ap-manifesto-object ap-manifesto-item"><PixelIcon index={1}/></span>
          <span className="ap-manifesto-word ap-manifesto-item">Give</span><span className="ap-manifesto-word ap-manifesto-item">agents</span><span className="ap-sticker ap-sticker-lavender ap-manifesto-item">a mandate</span>
          <span className="ap-manifesto-word ap-manifesto-item">to</span><span className="ap-manifesto-word ap-manifesto-item">act.</span>
          <span className="ap-manifesto-word ap-manifesto-item ap-grey">Keep</span><span className="ap-sticker ap-sticker-peach ap-manifesto-item">a budget</span><span className="ap-manifesto-word ap-manifesto-item">on-chain.</span>
          <span className="ap-manifesto-object ap-manifesto-item"><PixelIcon index={5}/></span>
          <span className="ap-manifesto-word ap-manifesto-item">Every</span><span className="ap-manifesto-word ap-manifesto-item">decision.</span><span className="ap-manifesto-word ap-manifesto-item">Every</span><span className="ap-manifesto-word ap-manifesto-item">payment.</span>
          <span className="ap-sticker ap-sticker-blue ap-manifesto-item">Inspectable.</span><div className="ap-manifesto-spacer"/>
        </div></div>
      </section>
      <section className="ap-start">
        <div><span className="ap-network"><i/>Built on QDay Aevum Testnet</span><h2>Give your agent<br/>room to work.</h2><p>Create a treasury. Define a mandate. Connect your agent.<br/>You control the funds from the first payment to the last.</p><a className="ap-button ap-button-light" href="/setup">Set up your agent <Arrow/></a></div>
        <div className="ap-start-note"><p>Real tUSD8 settlement on Aevum. GenLayer policy evaluation.<br/>A working testnet dapp with owner-controlled funds.</p><a href="/docs#architecture">Understand the controls and trust model <Arrow/></a></div>
      </section>
    </main>
    <footer className="ap-footer"><a href="/" className="ap-brand"><BrandMark/>AgentPay</a><div><a href="/scan">Scan</a><a href="/docs">Docs</a><a href="/docs#mcp">Agent skill & MCP</a><a href="https://explorer-test.qday.info/" target="_blank" rel="noreferrer">Aevum explorer</a></div><p>Financial authority for autonomous agents.</p></footer>
    <button className="ap-motion-toggle" type="button" onClick={()=>setPaused(p=>!p)} aria-pressed={paused} aria-label={paused ? "Enable story motion" : "Pause story motion"}>{paused ? "Enable motion" : "Pause motion"}</button>
  </div>;
}
