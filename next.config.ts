import type { NextConfig } from "next";
const config: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  outputFileTracingIncludes: {
    "/api/config": ["./contracts/artifacts/AgentTreasury.json"],
  },
  outputFileTracingExcludes: {
    "/*": [
      "./.local/**/*",
      "./.venv/**/*",
      "./.unlazy/**/*",
      "./tests/**/*",
      "./coverage/**/*",
      "./.env*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};
export default config;
