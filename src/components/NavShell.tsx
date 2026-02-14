"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/tenants", label: "Tenants" },
  { href: "/settings", label: "Settings" },
];

export default function NavShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

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

  return (
    <div className="min-h-screen">
      <nav className="border-b border-gray-800 bg-gray-900/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          <div className="flex items-center gap-6">
            <Link href="/" className="text-lg font-bold tracking-tight">
              Fleet
            </Link>
            <div className="flex gap-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    pathname === item.href
                      ? "bg-gray-800 text-white"
                      : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-300 transition-colors"
          >
            Logout
          </button>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>
    </div>
  );
}
