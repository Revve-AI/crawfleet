import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Revve Fleet Manager",
  description: "Manage per-employee OpenClaw instances",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-sans bg-zinc-950 text-zinc-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
