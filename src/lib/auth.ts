import { createClient } from "@/lib/supabase/server";
import { headers } from "next/headers";

/** Get the authenticated user's email. Throws "Unauthorized" if not logged in.
 *  In dev mode, reads from X-Auth-Email header (set by middleware). */
export async function getAuthEmail(): Promise<string> {
  if (process.env.NODE_ENV === "development") {
    const headerStore = await headers();
    const headerEmail = headerStore.get("X-Auth-Email");
    if (headerEmail) return headerEmail;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Unauthorized");
  return user.email;
}

/** Check if an email belongs to a fleet admin (can manage all tenants).
 *  In dev mode, dev@revve.ai is always admin. */
export function isFleetAdmin(email: string): boolean {
  if (process.env.NODE_ENV === "development" && email.toLowerCase() === "dev@revve.ai") {
    return true;
  }
  const raw = process.env.ADMIN_EMAILS || "";
  if (!raw) return false;
  const admins = raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.toLowerCase());
}

/** Require fleet admin access. Returns email. Throws "Forbidden" if not admin. */
export async function requireFleetAdmin(): Promise<string> {
  const email = await getAuthEmail();
  if (!isFleetAdmin(email)) {
    throw new Error("Forbidden");
  }
  return email;
}

// Keep backward compat — old name mapped to getAuthEmail
export const requireAdmin = getAuthEmail;
