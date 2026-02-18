"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const navItems = [
  {
    href: "/",
    label: "Dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1" />
        <rect x="14" y="3" width="7" height="5" rx="1" />
        <rect x="14" y="12" width="7" height="9" rx="1" />
        <rect x="3" y="16" width="7" height="5" rx="1" />
      </svg>
    ),
    match: (p: string) => p === "/",
  },
  {
    href: "/tenants",
    label: "Tenants",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    match: (p: string) => p.startsWith("/tenants"),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <line x1="4" x2="4" y1="21" y2="14" />
        <line x1="4" x2="4" y1="10" y2="3" />
        <line x1="12" x2="12" y1="21" y2="12" />
        <line x1="12" x2="12" y1="8" y2="3" />
        <line x1="20" x2="20" y1="21" y2="16" />
        <line x1="20" x2="20" y1="12" y2="3" />
        <line x1="1" x2="7" y1="14" y2="14" />
        <line x1="9" x2="15" y1="8" y2="8" />
        <line x1="17" x2="23" y1="16" y2="16" />
      </svg>
    ),
    match: (p: string) => p === "/settings",
  },
];

export default function NavShell({ children, isAdmin }: { children: React.ReactNode; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleLogout() {
    const res = await fetch("/api/auth/logout", { method: "POST" });
    const data = await res.json();
    if (data.redirectTo) {
      window.location.href = data.redirectTo;
    } else {
      router.push("/");
      router.refresh();
    }
  }

  const sidebarContent = (
    <>
      {/* Brand */}
      <div className="h-16 flex items-center gap-3 px-5 shrink-0">
        <img src="/logo.png" alt="Logo" className="w-8 h-8 rounded-lg" />
        <div className="leading-tight">
          <div className="text-sm font-semibold text-white tracking-tight">Revve</div>
          <div className="text-[10px] text-zinc-500 font-medium">Fleet Manager</div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.filter((item) => item.href !== "/settings" || isAdmin).map((item) => {
          const active = item.match(pathname);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setMobileOpen(false)}
              className={`group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] font-medium transition-all relative ${
                active
                  ? "bg-brand/10 text-brand"
                  : "text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800/50"
              }`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 bg-brand rounded-r-full" />
              )}
              <span className={active ? "text-brand" : "text-zinc-500 group-hover:text-zinc-300 transition-colors"}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Logout */}
      <div className="px-3 py-4 border-t border-zinc-800/50 shrink-0">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-[13px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 transition-colors w-full"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" x2="9" y1="12" y2="12" />
          </svg>
          Logout
        </button>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-56 md:flex-col fixed inset-y-0 left-0 z-30 border-r border-zinc-800/50 bg-zinc-950">
        {sidebarContent}
      </aside>

      {/* Mobile header */}
      <header className="md:hidden fixed top-0 left-0 right-0 h-14 border-b border-zinc-800/50 bg-zinc-950/90 backdrop-blur-lg z-20 flex items-center justify-between px-4">
        <button
          onClick={() => setMobileOpen(true)}
          className="p-1.5 -ml-1.5 text-zinc-400 hover:text-white transition-colors"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="4" y1="6" x2="20" y2="6" />
            <line x1="4" y1="12" x2="20" y2="12" />
            <line x1="4" y1="18" x2="20" y2="18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <img src="/logo.png" alt="Logo" className="w-6 h-6 rounded-md" />
          <span className="text-sm font-semibold">Fleet</span>
        </div>
        <div className="w-8" />
      </header>

      {/* Mobile overlay */}
      {mobileOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-30"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="md:hidden fixed inset-y-0 left-0 w-64 z-40 bg-zinc-950 border-r border-zinc-800/50 flex flex-col shadow-2xl">
            {sidebarContent}
          </aside>
        </>
      )}

      {/* Content */}
      <main className="flex-1 md:ml-56 pt-14 md:pt-0">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </div>
      </main>
    </div>
  );
}
