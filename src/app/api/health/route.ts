import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import { FleetStats } from "@/types";
import { apiError } from "@/lib/api-error";

export async function GET() {
  try {
    const email = await getAuthEmail();
    const where = isFleetAdmin(email) ? {} : { email };
    const tenants = await prisma.tenant.findMany({ where });
    const stats: FleetStats = {
      total: tenants.length,
      running: tenants.filter((t) => t.containerStatus === "running").length,
      stopped: tenants.filter((t) => t.containerStatus === "stopped").length,
      healthy: tenants.filter((t) => t.lastHealthStatus === "healthy").length,
      unhealthy: tenants.filter((t) => t.lastHealthStatus === "unhealthy").length,
    };

    return NextResponse.json({ success: true, data: stats });
  } catch (e) {
    return apiError(e);
  }
}
