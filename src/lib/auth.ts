import { getIronSession, IronSession } from "iron-session";
import { cookies, headers } from "next/headers";

export interface SessionData {
  isAdmin: boolean;
  email: string;
}

const sessionOptions = {
  password: process.env.SESSION_SECRET || "complex_password_at_least_32_characters_long_for_iron_session",
  cookieName: "fleet-session",
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax" as const,
    maxAge: 60 * 60 * 24, // 24 hours
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const cookieStore = await cookies();
  const session = await getIronSession<SessionData>(cookieStore, sessionOptions);

  if (!session.isAdmin) {
    const headerStore = await headers();
    const email = headerStore.get("X-Auth-Email");
    if (email) {
      session.isAdmin = true;
      session.email = email;
      await session.save();
    }
  }

  return session;
}

/** Get the authenticated user's email. Throws "Unauthorized" if not logged in.
 *  Reads from X-Auth-Email header first (set by middleware), falls back to session.
 *  This avoids session.save() which crashes in Server Components. */
export async function getAuthEmail(): Promise<string> {
  const headerStore = await headers();
  const headerEmail = headerStore.get("X-Auth-Email");
  if (headerEmail) return headerEmail;

  const session = await getSession();
  if (!session.isAdmin || !session.email) {
    throw new Error("Unauthorized");
  }
  return session.email;
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
