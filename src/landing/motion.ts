export type Pose = Readonly<{ x: number; y: number; rotation: number; scale: number; opacity: number }>;
export type Dimensions = Readonly<{ W: number; H: number; cw: number; mobile: boolean }>;
export const clamp = (n: number, min = 0, max = 1) => Math.min(max, Math.max(min, n));
export const phase = (p: number, start: number, end: number) => clamp((p - start) / (end - start));
export const ease = (p: number) => p < .5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2;
export const glide = (p: number) => 1 - (1 - p) ** 3;
export function dimensions(W: number, H: number): Dimensions {
  const mobile = W < 820 && W < H * 1.1;
  return { W, H, mobile, cw: mobile ? Math.min(W * .30, H * .2) : Math.min(W / 1440, H / 780) * 218 };
}
const pose = (x: number, y: number, rotation = 0, opacity = 1): Pose => ({ x, y, rotation, scale: 1, opacity });
const angleStep = (cw: number, R: number) => 2 * Math.asin(Math.min(.99, 1.05 * cw / (2 * R)));
export function fan(i: number, d: Dimensions): Pose {
  const { W, H, cw, mobile } = d;
  if (i > 5) return pose(W * .5, H * 1.4, 0, 0);
  const R = mobile ? W * 1.35 : 1250 * W / 1440;
  const angle = (i - 2.5) * angleStep(cw, R);
  return pose(W * (mobile ? .5 : .53) + R * Math.sin(angle), H * .86 + R - R * Math.cos(angle) + (mobile ? cw * .2 : 0), angle * 180 / Math.PI);
}
const scatterDesktop = [[.08,.46,-20],[.20,.86,-12],[.80,.84,14],[.38,1.04,-8],[.92,.42,16],[.62,1.04,9]] as const;
const scatterMobile = [[.06,.60,-20],[.45,.69,12],[.94,.60,16],[.22,.96,-14],[.72,.98,9],[.5,1.3,0]] as const;
function scatter(i: number, d: Dimensions): Pose {
  if (i > 5) return fan(i, d);
  const [x, y, rotation] = (d.mobile ? scatterMobile : scatterDesktop)[i];
  return pose(d.W * x, d.H * y, rotation);
}
function pile(i: number, d: Dimensions): Pose {
  return pose(d.W * .5 + ((i % 3) - 1) * d.cw * .08, d.H * .62 + (((i * 7) % 5) - 2) * d.cw * .04, (i % 2 ? -1 : 1) * (4 + i * 1.3));
}
function wheel(i: number, progress: number, d: Dimensions): Pose {
  const R = d.mobile ? d.W * 1.2 : 900 * d.W / 1440;
  const slot = ((i - 3 * progress + 12) % 12) - 5.5;
  const angle = slot * angleStep(d.cw, R);
  return pose(d.W * .5 + R * Math.sin(angle), d.H * (d.mobile ? .76 : .82) + R - R * Math.cos(angle), angle * 180 / Math.PI, Math.abs(angle) < 62 * Math.PI / 180 ? 1 : 0);
}
export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return { x: a.x + (b.x-a.x)*t, y: a.y + (b.y-a.y)*t, rotation: a.rotation + (b.rotation-a.rotation)*t, scale: a.scale + (b.scale-a.scale)*t, opacity: a.opacity + (b.opacity-a.opacity)*t };
}
export function cardTargets(p: number, d: Dimensions): readonly Pose[] {
  return Array.from({ length: 12 }, (_, i) => {
    if (p < .21) return blendPose(fan(i,d), scatter(i,d), ease(phase(p,.004,.085)));
    if (p < .31) return blendPose(scatter(i,d), pile(i,d), ease(phase(p,.21,.31)));
    if (p < .41) return blendPose(pile(i,d), wheel(i,0,d), glide(phase(p,.31,.41)));
    return wheel(i,ease(phase(p,.41,.57)),d);
  });
}
export function panelsSettled(current: readonly Pose[], target: readonly Pose[]) {
  return current.length === target.length && current.every((p,i) => Math.abs(p.x-target[i].x) < 3 && Math.abs(p.y-target[i].y) < 3 && Math.abs(p.rotation-target[i].rotation) < 1);
}
