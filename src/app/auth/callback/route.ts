import { NextRequest, NextResponse } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // request.url uses the internal bind address (0.0.0.0:3000) behind Cloudflare Tunnel,
  // so derive the public origin from forwarded headers instead.
  const proto = request.headers.get("x-forwarded-proto") || "https";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  const origin = `${proto}://${host}`;

  if (!code) {
    return NextResponse.redirect(`${origin}/login`);
  }

  const response = NextResponse.redirect(`${origin}${next}`);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options: CookieOptions }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    return NextResponse.redirect(`${origin}/login`);
  }

  // Auto-promote admin: ADMIN_EMAILS list, or first-ever user
  const supabaseAdmin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  if (data.user.app_metadata?.role !== "admin") {
    const adminEmails = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);

    const userEmail = data.user.email?.toLowerCase() || "";
    let shouldPromote = adminEmails.includes(userEmail);

    // First user to sign up becomes admin automatically
    if (!shouldPromote) {
      const { data: { users } } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 2 });
      if (users && users.length <= 1) {
        shouldPromote = true;
      }
    }

    if (shouldPromote) {
      await supabaseAdmin.auth.admin.updateUserById(data.user.id, {
        app_metadata: { role: "admin" },
      });
    }
  }

  return response;
}
