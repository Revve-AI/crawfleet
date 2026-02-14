import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { writeConfig, recreateContainer, removeContainer, removeTenantData } from "@/lib/docker";
import { deleteTenantAccessApp } from "@/lib/cloudflare-access";
import { TenantUpdateInput } from "@/types";

type Params = { params: Promise<{ slug: string }> };

function safeParseOverrides(raw: string | null): Record<string, string> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Return override keys (names only, no values) for safe API response */
function overrideKeyNames(raw: string | null): string[] {
  return Object.keys(safeParseOverrides(raw));
}

export async function GET(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Strip raw override values, return key names only
    const { envOverrides, ...rest } = tenant;
    return NextResponse.json({
      success: true,
      data: { ...rest, envOverrideKeys: overrideKeyNames(envOverrides) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const { email: _email, envOverrides: incomingOverrides, ...body }: TenantUpdateInput & { email?: string } = await req.json();

    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Check if provider access changed (requires container restart)
    const providerChanged =
      (body.allowAnthropic !== undefined && body.allowAnthropic !== tenant.allowAnthropic) ||
      (body.allowOpenAI !== undefined && body.allowOpenAI !== tenant.allowOpenAI) ||
      (body.allowGemini !== undefined && body.allowGemini !== tenant.allowGemini) ||
      (body.allowBrave !== undefined && body.allowBrave !== tenant.allowBrave) ||
      (body.allowElevenLabs !== undefined && body.allowElevenLabs !== tenant.allowElevenLabs);

    // Merge env overrides: existing + incoming. Empty string value = delete that key.
    let envChanged = false;
    const dbData: Record<string, unknown> = { ...body };
    if (incomingOverrides) {
      const existing = safeParseOverrides(tenant.envOverrides);
      for (const [k, v] of Object.entries(incomingOverrides)) {
        if (!v || v.trim() === "") {
          if (k in existing) { delete existing[k]; envChanged = true; }
        } else {
          existing[k] = v.trim();
          envChanged = true;
        }
      }
      dbData.envOverrides = Object.keys(existing).length > 0 ? JSON.stringify(existing) : null;
    }

    const needsRestart = providerChanged || envChanged;

    const updated = await prisma.tenant.update({
      where: { slug },
      data: dbData,
    });

    // Always rewrite config
    await writeConfig(updated);

    // If provider access or env overrides changed, recreate container
    if (needsRestart && updated.containerId) {
      const newId = await recreateContainer(updated);
      await prisma.tenant.update({
        where: { slug },
        data: { containerId: newId, containerStatus: "running" },
      });
    }

    await prisma.auditLog.create({
      data: {
        tenantId: tenant.id,
        action: needsRestart ? "tenant.provider_changed" : "config.updated",
        details: JSON.stringify({ ...body, ...(incomingOverrides ? { envOverrides: Object.keys(incomingOverrides) } : {}) }),
      },
    });

    const { envOverrides: rawOverrides, ...safeData } = updated;
    return NextResponse.json({
      success: true,
      data: { ...safeData, envOverrideKeys: overrideKeyNames(rawOverrides) },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    await requireAdmin();
    const { slug } = await params;
    const tenant = await prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (tenant.accessAppId) {
      try {
        await deleteTenantAccessApp(tenant.accessAppId);
      } catch (cfErr) {
        console.error("Failed to delete Cloudflare Access app:", cfErr);
      }
    }

    if (tenant.containerId) {
      await removeContainer(tenant.containerId);
    }
    await removeTenantData(slug);

    await prisma.auditLog.create({
      data: { tenantId: null, action: "tenant.deleted", details: JSON.stringify({ slug }) },
    });

    await prisma.tenant.delete({ where: { slug } });

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
