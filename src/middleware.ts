import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

const TEAM_DOMAIN = process.env.CLOUDFLARE_TEAM_DOMAIN;
const AUD = process.env.CF_ACCESS_AUD;

const JWKS_URL = TEAM_DOMAIN
  ? new URL(`https://${TEAM_DOMAIN}.cloudflareaccess.com/cdn-cgi/access/certs`)
  : undefined;

const jwks = JWKS_URL ? createRemoteJWKSet(JWKS_URL) : undefined;

export async function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === "development") {
    const headers = new Headers(request.headers);
    headers.set("X-Auth-Email", "dev@revve.ai");
    return NextResponse.next({ request: { headers } });
  }

  if (!jwks || !AUD || !TEAM_DOMAIN) {
    return new NextResponse("Cloudflare Access not configured", { status: 500 });
  }

  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const { payload } = await jwtVerify(token, jwks, {
      audience: AUD,
      issuer: `https://${TEAM_DOMAIN}.cloudflareaccess.com`,
    });

    const email = payload.email as string | undefined;
    if (!email || !email.endsWith("@revve.ai")) {
      return new NextResponse("Forbidden", { status: 403 });
    }

    const headers = new Headers(request.headers);
    headers.set("X-Auth-Email", email);
    return NextResponse.next({ request: { headers } });
  } catch {
    return new NextResponse("Invalid token", { status: 401 });
  }
}

export const config = {
  matcher: ["/((?!_next|favicon\\.ico).*)"],
};
