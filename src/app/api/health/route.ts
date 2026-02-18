import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import { FleetStats } from "@/types";
import { apiError } from "@/lib/api-error";

export async function GET() {
  try {
    const email = await getAuthEmail();
    const admin = isFleetAdmin(email);

    let query = supabaseAdmin.from("tenants").select("container_status, last_health_status");
    if (!admin) {
      query = query.eq("email", email);
    }

    const { data: tenants } = await query;
    const list = tenants || [];

    const stats: FleetStats = {
      total: list.length,
      running: list.filter((t) => t.container_status === "running").length,
      stopped: list.filter((t) => t.container_status === "stopped").length,
      healthy: list.filter((t) => t.last_health_status === "healthy").length,
      unhealthy: list.filter((t) => t.last_health_status === "unhealthy").length,
    };

    return NextResponse.json({ success: true, data: stats });
  } catch (e) {
    return apiError(e);
  }
}
