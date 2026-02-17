import { NextRequest } from "next/server";
import { prisma } from "@/lib/db";
import { requireFleetAdmin } from "@/lib/auth";
import { getProvider } from "@/lib/providers";
import { sseResponse, type SSESend } from "@/lib/sse";

type Params = { params: Promise<{ slug: string }> };

export async function POST(req: NextRequest, { params }: Params) {
  return sseResponse(async (send: SSESend) => {
    await requireFleetAdmin();
    const { slug } = await params;

    const tenant = await prisma.tenant.findUnique({
      where: { slug },
      include: { vpsInstance: true },
    });
    if (!tenant) throw new Error("Not found");

    const body = await req.json().catch(() => ({}));
    const dbData: Record<string, unknown> = {};

    if (tenant.provider === "docker") {
      // Docker: handle image changes
      if (!tenant.containerId) throw new Error("No container");

      if (body.image && typeof body.image === "string") {
        dbData.image = body.image.trim();
      }
    } else {
      // VPS: handle git tag changes
      if (body.gitTag && typeof body.gitTag === "string" && tenant.vpsInstance) {
        await prisma.vpsInstance.update({
          where: { id: tenant.vpsInstance.id },
          data: { gitTag: body.gitTag.trim() },
        });
        // Refresh tenant data
        tenant.vpsInstance.gitTag = body.gitTag.trim();
      }
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
        ? await prisma.tenant.update({
            where: { slug },
            data: dbData,
            include: { vpsInstance: true },
          })
        : tenant;

    send("status", { step: "Starting deploy" });

    const provider = await getProvider(updated);
    const newId = await provider.deploy(updated, (step) => {
      send("status", { step });
    });

    if (tenant.provider === "docker") {
      await prisma.tenant.update({
        where: { slug },
        data: { containerId: newId, containerStatus: "running" },
      });
    } else {
      await prisma.tenant.update({
        where: { slug },
        data: { containerStatus: "running" },
      });
    }

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: "tenant.deployed",
        details: JSON.stringify({
          provider: tenant.provider,
          ...(dbData.image ? { image: dbData.image } : {}),
          ...(body.gitTag ? { gitTag: body.gitTag } : {}),
          ...(body.envOverrides ? { envOverrides: Object.keys(body.envOverrides) } : {}),
        }),
      },
    });

    send("done", { containerId: newId });
  });
}
