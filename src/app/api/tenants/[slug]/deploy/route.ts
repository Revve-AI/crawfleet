import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireFleetAdmin } from "@/lib/auth";
import { deployContainer } from "@/lib/docker";
import { sseResponse, type SSESend } from "@/lib/sse";

type Params = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    await requireFleetAdmin();
    const { slug } = await params;

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw new Error("Not found");
    if (!tenant.containerId) throw new Error("No container");

    const body = await req.json().catch(() => ({}));
    const dbData: Record<string, unknown> = {};

    if (body.image && typeof body.image === "string") {
      dbData.image = body.image.trim();
    }

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

    const updated =
      Object.keys(dbData).length > 0
        ? await prisma.tenant.update({ where: { slug }, data: dbData })
        : tenant;

    send("status", { step: "Starting deploy" });

    const newId = await deployContainer(updated, (step) => {
      send("status", { step });
    });

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

    send("done", { containerId: newId });
  });
}
