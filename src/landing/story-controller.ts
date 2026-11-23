import { blendPose, cardTargets, clamp, dimensions, ease, fan, phase, panelsSettled, type Pose } from "./motion";
const skyVideo = "https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20261118_065029_a6ae2ebb-cd79-41fd-ae60-6b66fdda04ee.mp4";
export function initStory(root: HTMLDivElement, paused: boolean) {
  const story = root.querySelector<HTMLElement>(".ap-story")!;
  const hero = root.querySelector<HTMLElement>(".ap-hero")!;
  const cards = Array.from(root.querySelectorAll<HTMLElement>(".ap-card"));
  const process = root.querySelector<HTMLElement>(".ap-process")!;
  const sky = root.querySelector<HTMLElement>(".ap-sky")!;
  const vault = root.querySelector<HTMLElement>(".ap-vault")!;
  const video = root.querySelector<HTMLVideoElement>(".ap-sky-video")!;
  const blackout = root.querySelector<HTMLElement>(".ap-blackout")!;
  const manifesto = root.querySelector<HTMLElement>(".ap-manifesto")!;
  const track = root.querySelector<HTMLElement>(".ap-manifesto-track")!;
  const icons = Array.from(root.querySelectorAll<HTMLElement>(".ap-pixel"));
  const letters = Array.from(root.querySelectorAll<HTMLElement>(".ap-letter"));
  const plane = root.querySelector<HTMLElement>(".ap-flying-plane")!;
  const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
  let d = dimensions(innerWidth, innerHeight);
  let poses: readonly Pose[] = cardTargets(0,d);
  let frame = 0;
  let last = performance.now();
  let started = last;
  let sy = window.scrollY;
  let skyProgress = 0;
  let wheelFinished = false;
  let reduced = preference.matches || paused;
  let videoFailed = false;
  const mobileScreen = () => {
    d = dimensions(innerWidth, innerHeight);
    root.style.setProperty("--cw", `${d.cw}px`);
    root.style.setProperty("--hfs", `${d.mobile ? Math.min(d.W*.12,d.H*.09) : Math.min(d.W*.074,d.H*.135)}px`);
    root.style.setProperty("--pfs", `${d.mobile ? Math.min(d.W*.085,40) : Math.min(d.W*.0335,d.H*.062)}px`);
    root.style.setProperty("--sfs", `${d.mobile ? Math.min(d.W*.09,44) : Math.min(d.W*.042,d.H*.078)}px`);
    root.style.setProperty("--mfs", `${d.mobile ? Math.min(d.W*.11,d.H*.075) : Math.min(d.W*.05,d.H*.1)}px`);
    root.style.setProperty("--camw", `${d.mobile ? Math.min(d.W*.62,d.H*.34) : Math.min(d.W*.25,d.H*.46)}px`);
    root.classList.toggle("ap-portrait",d.mobile);
    poses = cardTargets(phase(window.scrollY,story.offsetTop,story.offsetTop+story.offsetHeight-d.H),d);
  };
  const preferenceChange = () => {
    reduced = preference.matches || paused;
    root.classList.toggle("ap-reduced", reduced);
    mobileScreen();
    if (reduced) { video.pause(); video.removeAttribute("src"); video.load(); }
  };
  const onVideoError = () => { videoFailed = true; video.style.opacity = "0"; };
  const applyPose = (el: HTMLElement, p: Pose) => {
    el.style.transform = `translate3d(${p.x}px,${p.y}px,0) rotate(${p.rotation}deg) scale(${p.scale})`;
    el.style.opacity = String(p.opacity);
  };
  function intro(t: number) {
    const letterCount = t < 1.9 ? 0 : Math.min(letters.length, Math.floor((t-1.9)/.22)+1);
    const remaining = Math.ceil(7 * (letters.length-letterCount)/letters.length);
    letters.forEach((el,i) => {
      const q = phase(t,1.9+i*.22,2.1+i*.22);
      el.style.display = i < letterCount ? "inline-block" : "none";
      el.style.clipPath = `inset(0 ${100-q*100}% 0 0)`;
    });
    icons.forEach((el,i) => {
      const q = phase(t,1.27+i*.07,1.59+i*.07);
      el.style.display = i < remaining ? "block" : "none";
      el.style.opacity = String(q);
      el.style.transform = `scale(${q < 1 ? 1-(1-q)**3 : 1})`;
    });
    const fly = phase(t,.33,1.27);
    const x = -3 + fly * 45;
    const y = 73 - Math.sin(fly * Math.PI*.75)*34;
    plane.style.transform = `translate3d(${x*d.W/100}px,${y*d.H/100}px,0) rotate(${-24+fly*42}deg) scale(${1-phase(t,1.27,1.33)*.4})`;
    plane.style.opacity = t > .33 && t < 1.33 ? String(1-phase(t,1.27,1.33)) : "0";
  }
  function animate(now: number) {
    const dt = Math.min(50,now-last); last = now;
    if (document.hidden) { frame = requestAnimationFrame(animate); return; }
    const t = (now-started)/1000;
    const smoothing = 1-(1-.06)**(dt/16.67);
    sy = reduced ? window.scrollY : sy+(window.scrollY-sy)*smoothing;
    const p = phase(sy,story.offsetTop,story.offsetTop+story.offsetHeight-d.H);
    if (reduced) {
      root.classList.remove("ap-dark-nav");
      cards.forEach(el => { el.style.removeProperty("transform"); el.style.removeProperty("opacity"); });
      letters.forEach(el => { el.style.display="inline-block"; el.style.clipPath="none"; });
      icons.forEach(el => { el.style.display="none"; });
      hero.style.opacity="1"; process.style.opacity="1"; process.style.visibility="visible"; sky.style.clipPath="none"; sky.style.opacity="1"; vault.style.transform="none"; blackout.style.opacity="0"; track.style.transform="none";
    } else {
      intro(t);
      hero.style.opacity=String(1-phase(window.scrollY,0,d.H*.53));
      const target=cardTargets(p,d);
      poses=poses.map((current,i) => {
        if(p<.003 && t<1.7) {
          const order=[2,3,1,4,5,0][i] ?? 0;
          const q=phase(t,.53+order*.066,1.23+order*.066);
          const back=1+2.15*(q-1)**3+1.15*(q-1)**2;
          return i<6 ? blendPose({...fan(i,d),y:d.H+d.cw*1.2,rotation:fan(i,d).rotation+8},fan(i,d),back) : target[i];
        }
        return blendPose(current,target[i],1-(1-(.055+(i%4)*.008))**(dt/16.67));
      });
      poses.forEach((q,i)=>applyPose(cards[i],q));
      process.style.opacity=String(phase(p,.05,.075)*(1-phase(p,.62,.70)));
      process.style.visibility=p>.05 && p<.699 ? "visible":"hidden";
      root.classList.toggle("ap-process-reveal",p>.078);
      if (p<.57) wheelFinished=false;
      else if (panelsSettled(poses,target)) wheelFinished=true;
      const skyTarget=wheelFinished ? phase(p,.62,.74) : 0;
      skyProgress+=(skyTarget-skyProgress)*(1-(1-.09)**(dt/16.67));
      const sp=ease(clamp(skyProgress));
      const insetX=(d.mobile ? 29 : 41.5)*(1-sp);
      const insetTop=(d.mobile ? 36 : 28)*(1-sp);
      const insetBottom=(d.mobile ? 48 : 52)*(1-sp);
      sky.style.clipPath=`inset(${insetTop}% ${insetX}% ${insetBottom}% round ${14*(1-sp)}px)`;
      sky.style.opacity=skyProgress>.001 ? "1":"0";
      const q=phase(p,.88,.97)**1.6*phase(skyProgress,.9,1);
      vault.style.transform=`perspective(900px) translateY(${Math.sin(t*1.6)*6}px) rotateY(${-10+20*phase(p,.74,.88)}deg) scale(${(.5+sp*.5)*(1+q*q*28)})`;
      blackout.style.opacity=String(phase(q,.45,.85));
      root.classList.toggle("ap-sky-reveal",skyProgress>.985);
      if (skyProgress>.1 && p<.98 && !videoFailed) {
        if(!video.getAttribute("src")) { video.src=skyVideo; video.playbackRate=.6; }
        if(video.paused) void video.play().catch(()=>{ videoFailed=true; });
      } else if(!video.paused) video.pause();
      const mp=phase(sy,manifesto.offsetTop,manifesto.offsetTop+manifesto.offsetHeight-d.H);
      const travel=Math.max(0,track.scrollWidth-d.W*.9);
      track.style.transform=`translate3d(${d.W*.06-mp*(travel+d.W*.06)}px,-50%,0)`;
      root.querySelectorAll<HTMLElement>(".ap-manifesto-item").forEach(el=>{
        if(manifesto.getBoundingClientRect().top<d.H*.8 && el.getBoundingClientRect().left<d.W*.86) el.classList.add("ap-seen");
      });
      root.classList.toggle("ap-dark-nav", p>.985 || window.scrollY>manifesto.offsetTop-d.H*.1);
    }
    frame=requestAnimationFrame(animate);
  }
  const onAnchor = (event: MouseEvent) => {
    if (reduced || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href^='#']") : null;
    const progress = link?.hash === "#how-it-works" ? .20 : link?.hash === "#your-control" ? .76 : null;
    if (progress === null) return;
    event.preventDefault();
    window.scrollTo({ top: story.offsetTop + (story.offsetHeight-d.H)*progress, behavior:"smooth" });
    history.replaceState(null,"",link!.hash);
  };
  mobileScreen(); preferenceChange();
  root.addEventListener("click",onAnchor);
  window.addEventListener("resize",mobileScreen);
  preference.addEventListener("change",preferenceChange);
  video.addEventListener("error",onVideoError);
  root.classList.add("ap-motion-ready");
  frame=requestAnimationFrame(animate);
  return () => { cancelAnimationFrame(frame); root.removeEventListener("click",onAnchor); window.removeEventListener("resize",mobileScreen); preference.removeEventListener("change",preferenceChange); video.removeEventListener("error",onVideoError); video.pause(); };
}
