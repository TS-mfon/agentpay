import { describe, expect, it } from "vitest";
import { dimensions, cardTargets, blendPose, phase, panelsSettled } from "../../src/landing/motion";

describe("landing choreography", () => {
  it("uses portrait choreography without treating landscape phones as portrait", () => {
    expect(dimensions(375, 812).mobile).toBe(true);
    expect(dimensions(768, 1024).mobile).toBe(true);
    expect(dimensions(812, 375).mobile).toBe(false);
  });
  it("holds six hero cards then joins all twelve in the pile", () => {
    const d = dimensions(1440, 900);
    expect(cardTargets(0, d).filter(p => p.opacity > 0).length).toBe(6);
    expect(cardTargets(.31, d).every(p => p.opacity === 1)).toBe(true);
  });
  it("keeps a visible gap between neighboring fan cards", () => {
    const d = dimensions(1440, 900);
    const poses = cardTargets(0, d);
    expect(Math.hypot(poses[1].x - poses[0].x, poses[1].y - poses[0].y)).toBeCloseTo(d.cw * 1.05, 4);
  });
  it("rotates the wheel right-to-left and holds its final pose", () => {
    const d = dimensions(1440, 900);
    expect(cardTargets(.57, d)[6].x).toBeLessThan(cardTargets(.41, d)[6].x);
    expect(cardTargets(.62, d)).toEqual(cardTargets(.57, d));
  });
  it("requires every card to settle before opening the sky window", () => {
    const target = cardTargets(.62, dimensions(1440, 900));
    expect(panelsSettled(target, target)).toBe(true);
    expect(panelsSettled(target.map(p => ({ ...p, x: p.x + 4 })), target)).toBe(false);
    expect(panelsSettled(target.map(p => ({ ...p, rotation: p.rotation + 2 })), target)).toBe(false);
  });
  it("interpolates immutably and clamps phase progress", () => {
    const from = { x: 0, y: 0, rotation: 0, scale: 1, opacity: 0 };
    const to = { ...from, x: 20, opacity: 1 };
    expect(blendPose(from, to, .5)).toEqual({ ...from, x: 10, opacity: .5 });
    expect(from.x).toBe(0);
    expect(phase(-1, .2, .3)).toBe(0);
    expect(phase(1, .2, .3)).toBe(1);
  });
});
