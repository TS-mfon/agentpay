import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "AgentPay — Governed agent payments",
  description:
    "Give AI agents a spending mandate. Inspect their decisions and settle authorized payments on QDay Aevum.",
  icons: { icon: "/icon.svg" },
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
