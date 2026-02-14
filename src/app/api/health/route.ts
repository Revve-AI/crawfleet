import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { FleetStats } from "@/types";

export async function GET() {
  try {
    await requireAdmin();

    const tenants = await prisma.tenant.findMany();
    const stats: FleetStats = {
      total: tenants.length,
      running: tenants.filter((t) => t.containerStatus === "running").length,
      stopped: tenants.filter((t) => t.containerStatus === "stopped").length,
      healthy: tenants.filter((t) => t.lastHealthStatus === "healthy").length,
      unhealthy: tenants.filter((t) => t.lastHealthStatus === "unhealthy").length,
    };

    return NextResponse.json({ success: true, data: stats });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
