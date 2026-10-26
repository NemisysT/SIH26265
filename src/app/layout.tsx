import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Security Deposit & FDR Portal", template: "%s · SD/FDR Portal" },
  description: "Prototype portal for managing institutional security deposits and fixed deposit receipts (SIH PS 26265).",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
