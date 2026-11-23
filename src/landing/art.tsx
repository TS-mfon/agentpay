import type { CSSProperties } from "react";
export const services = [
  ["Research", "Discover what matters", "#B0AEC6"],
  ["APIs", "Connect to useful services", "#DDAD95"],
  ["Compute", "Power the next task", "#7DA3BB"],
  ["Data", "Find the right context", "#EBC9AE"],
  ["Storage", "Keep the work accessible", "#BAD9E6"],
  ["Agent services", "Work with other agents", "#BF9FA5"],
  ["A mandate", "Purpose before payment", "#EFCEBE"],
  ["A budget", "Hard limits on-chain", "#B0AEC6"],
  ["Authorization", "Scoped to your agent", "#7DA3BB"],
  ["Settlement", "tUSD8 on QDay Aevum", "#DDAD95"],
  ["A receipt", "A verifiable payment record", "#BAD9E6"],
  ["Your control", "Pause, revoke, withdraw", "#EBC9AE"],
] as const;
export function BrandMark() {
  return <svg width="42" height="42" viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M9 32 22 8h5l12 24h-8l-6-12-7 12H9Z" fill="currentColor"/><path d="M9 39h30" stroke="currentColor" strokeWidth="5" strokeLinecap="round"/><circle cx="25" cy="29" r="3" fill="currentColor"/></svg>;
}
export function Arrow() {
  return <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
const pixels = [
  ["........k","......kkb","....kkwkb","..kkwwkb.","kkwwwkbb.","..kkkbb..","....kb...","....k....","........."],
  ["..kkkkk..",".kwwwwwk.","kwkbkbkwk","kwbbbbbwk","kwbwbwbwk","kwbbbbbwk",".kwwwwwk.","..kkkkk..","........."],
  ["...kkk...","..kwwwk..",".kwkkkwk.","kwwk.kwwk","kwwk.kwwk",".kwkkkwk.","..kwwwk..","...kkk...","........."],
  ["..kkkkk..",".kbwwwbk.",".kbwbwbk.",".kbwwwbk.",".kbwbwbk.",".kbwwwbk.","..kbbbk..","...kkk...","........."],
  ["...kkk...","..kpppk..",".kpppppk.","kpkwkwkpk","kpppppppk",".kpppppk.","..kpppk..","...kkk...","........."],
  ["..kkkkk..","..kwwwk..","..kwkwk..","..kwwwk..","..kwkwk..","..kwwwk..","..kwwwk..","..kkkkk..","........."],
  ["....k....","...kpk...","..kpppk..",".kpppppk.","kpppppppk",".kpppppk.","..kpppk..","...kpk...","....k...."],
] as const;
export function PixelIcon({ index }: { index: number }) {
  const palette: Record<string,string> = { k: "#1F2430", b: "#7DA3BB", w: "#fff", p: "#DDAD95" };
  return <svg viewBox="0 0 9 9" shapeRendering="crispEdges" aria-hidden="true">{pixels[index % 7].flatMap((row,y)=>[...row].map((cell,x)=>cell==="." ? null : <rect key={`${x}-${y}`} x={x} y={y} width="1.02" height="1.02" fill={palette[cell]}/>))}</svg>;
}
export function ServiceArt({ index }: { index: number }) {
  const turns = index % 3;
  return <svg viewBox="0 0 180 180" fill="none" aria-hidden="true">
    <g transform={`translate(90 85) rotate(${turns * 30})`}>
      {Array.from({length:6},(_,i)=><rect key={i} x="-31" y="-58" width="62" height="116" rx={index % 2 ? 31 : 14} transform={`rotate(${i*30})`} fill="white" fillOpacity=".12" stroke="#1F2430" strokeOpacity=".65" strokeWidth="1.2"/>)}
      <circle r="30" fill="white" fillOpacity=".6"/>
      <path d={index % 2 ? "M-14 0h28M0-14v28" : "m-14 0 10 10 18-22"} stroke="#1F2430" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    </g>
    <circle cx="24" cy="22" r="3" fill="#1F2430"/>
    <path d="M35 22h25M120 148h35" stroke="#1F2430" strokeOpacity=".4"/>
  </svg>;
}
export function VaultArt({ style }: { style?: CSSProperties }) {
  return <div className="ap-vault-object" style={style}><svg viewBox="0 0 360 380" fill="none" aria-hidden="true">
    <defs><linearGradient id="vault-top" x1="30" y1="30" x2="260" y2="250" gradientUnits="userSpaceOnUse"><stop stopColor="#FFFDF5"/><stop offset="1" stopColor="#DAD4C7"/></linearGradient><linearGradient id="vault-face" x1="40" y1="120" x2="220" y2="340" gradientUnits="userSpaceOnUse"><stop stopColor="#F7F1E8"/><stop offset="1" stopColor="#CCC7BC"/></linearGradient><linearGradient id="vault-side" x1="220" y1="100" x2="320" y2="320" gradientUnits="userSpaceOnUse"><stop stopColor="#E9E1D3"/><stop offset="1" stopColor="#A6A5A4"/></linearGradient><radialGradient id="dial"><stop stopColor="#607487"/><stop offset=".7" stopColor="#2D3440"/><stop offset="1" stopColor="#141A24"/></radialGradient></defs>
    <ellipse cx="183" cy="330" rx="120" ry="16" fill="#4B465E" opacity=".12"/>
    <path d="M59 114 200 66l105 53-139 50-107-55Z" fill="url(#vault-top)"/>
    <path d="m166 169 139-50v153l-139 54V169Z" fill="url(#vault-side)"/>
    <path d="m59 114 107 55v157L59 271V114Z" fill="url(#vault-face)"/>
    <path d="m74 143 77 39v117l-77-39V143Z" fill="#F9F4EA" stroke="#B9B3A9" strokeWidth="2"/>
    <ellipse cx="112" cy="224" rx="29" ry="34" transform="rotate(-13 112 224)" fill="url(#dial)"/>
    <ellipse cx="112" cy="224" rx="15" ry="19" fill="#D9C6AD"/>
    <path d="m108 211 4 14 10-1M99 229l13-4 5 15" stroke="#F4EDE0" strokeWidth="4" strokeLinecap="round"/>
    <path d="M79 159v16m0 68v16" stroke="#8D8C87" strokeWidth="5" strokeLinecap="round"/>
    <rect x="199" y="105" width="55" height="7" rx="3.5" transform="rotate(25 199 105)" fill="#9F9E94"/>
    <circle cx="259" cy="235" r="17" fill="#EAD9C1" fillOpacity=".7"/>
    <path d="m252 239 7-12 7 12h-5l-2-5-3 5h-4Z" fill="#747477"/>
  </svg></div>;
}
