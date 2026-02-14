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

export async function requireAdmin(): Promise<void> {
  const session = await getSession();
  if (!session.isAdmin) {
    throw new Error("Unauthorized");
  }
}
