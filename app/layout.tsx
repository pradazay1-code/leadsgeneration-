import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stock Wizard — Daily Trade & Long-Term Investment Scanner",
  description:
    "Analytical stock scanner: daily momentum trade candidates and long-term compounders, scored on volume, trend, RSI, MACD, drawdown, and valuation.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
