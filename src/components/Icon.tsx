type Name =
  | "grid"
  | "send"
  | "shield"
  | "clock"
  | "wallet"
  | "plus"
  | "arrow"
  | "check"
  | "close"
  | "key"
  | "refresh"
  | "external"
  | "pause"
  | "play"
  | "search";
const paths: Record<Name, string> = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  send: "m22 2-7 20-4-9-9-4Z M22 2 11 13",
  shield: "M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7z M8 12l3 3 5-6",
  clock: "M12 8v4l3 2 M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  wallet: "M3 5h16v14H3z M3 5V3h14 M15 10h6v5h-6z",
  plus: "M12 5v14M5 12h14",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  check: "m5 12 4 4L19 6",
  close: "m6 6 12 12M6 18 18 6",
  key: "M15 7a5 5 0 1 1-3 9L3 22l-2-2 6-6a5 5 0 0 1 8-7 M15 10h.01",
  refresh: "M20 6v5h-5M4 18v-5h5M20 11a8 8 0 0 0-14-6M4 13a8 8 0 0 0 14 6",
  external: "M14 3h7v7M21 3 10 14M10 3H3v18h18v-7",
  pause: "M8 4v16M16 4v16",
  play: "m7 3 14 9-14 9Z",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14m5-2 5 5",
};
export default function Icon({
  name,
  size = 20,
}: {
  name: Name;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
