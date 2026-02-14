import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function POST() {
  const session = await getSession();
  session.destroy();

  const teamDomain = process.env.CLOUDFLARE_TEAM_DOMAIN;
  if (teamDomain) {
    return NextResponse.json({
      success: true,
      redirectTo: `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/logout`,
    });
  }

  return NextResponse.json({ success: true });
}
