import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireFleetAdmin } from "@/lib/auth";
import { recreateContainer } from "@/lib/docker";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  try {
    await requireFleetAdmin();
    const { slug } = await params;

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!tenant.containerId) {
      return NextResponse.json({ error: "No container" }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const dbData: Record<string, unknown> = {};

    // Optional image override — persisted so future recreations use it too
    if (body.image && typeof body.image === "string") {
      dbData.image = body.image.trim();
    }

    // Optional env override merge (same logic as PATCH)
    if (body.envOverrides && typeof body.envOverrides === "object") {
      const existing: Record<string, string> = tenant.envOverrides
        ? JSON.parse(tenant.envOverrides)
        : {};
      for (const [k, v] of Object.entries(body.envOverrides as Record<string, string>)) {
        if (!v || String(v).trim() === "") {
          delete existing[k];
        } else {
          existing[k] = String(v).trim();
        }
      }
      dbData.envOverrides =
        Object.keys(existing).length > 0 ? JSON.stringify(existing) : null;
    }

    // Persist changes before recreate so the container picks them up
    const updated =
      Object.keys(dbData).length > 0
        ? await prisma.tenant.update({ where: { slug }, data: dbData })
        : tenant;

    const newId = await recreateContainer(updated);
    await prisma.tenant.update({
      where: { slug },
      data: { containerId: newId, containerStatus: "running" },
    });

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: "tenant.deployed",
        details: JSON.stringify({
          ...(dbData.image ? { image: dbData.image } : {}),
          ...(body.envOverrides ? { envOverrides: Object.keys(body.envOverrides) } : {}),
        }),
      },
    });

    return NextResponse.json({ success: true, containerId: newId });
  } catch (e) {
    return apiError(e);
  }
}
