import {
  studioDevnet,
  studionet,
  testnetBradbury,
  testnetAsimov,
} from "genlayer-js/chains";
export function governanceChain() {
  const name = process.env.GENLAYER_NETWORK || "studio-dev";
  if (name === "studio-dev" || name === "studio-next") return studioDevnet;
  if (name === "studionet") return studionet;
  if (name === "bradbury") return testnetBradbury;
  if (name === "asimov") return testnetAsimov;
  throw new Error(
    "Unknown GenLayer network. Use the documented studio-dev, studionet or testnet presets.",
  );
}
