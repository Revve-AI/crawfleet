import { createClient } from "@/lib/supabase/server";

/** Get the authenticated user's email. Throws "Unauthorized" if not logged in. */
export async function getAuthEmail(): Promise<string> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Unauthorized");
  return user.email;
}

/** Check if an email belongs to a fleet admin (can manage all tenants). */
export function isFleetAdmin(email: string): boolean {
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
