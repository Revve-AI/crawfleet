import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

function mask(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "..." + value.slice(-4);
}

export async function GET() {
  try {
    await requireAdmin();

    const settings = await prisma.globalSetting.findMany({
      orderBy: { key: "asc" },
    });

    const data = settings.map((s) => ({
      key: s.key,
      masked: mask(s.value),
      updatedAt: s.updatedAt.toISOString(),
    }));

    return NextResponse.json({ success: true, data });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireAdmin();
    const body: Record<string, string> = await req.json();

    for (const [key, value] of Object.entries(body)) {
      if (!key.trim()) continue;

      if (!value || value.trim() === "") {
        await prisma.globalSetting.deleteMany({ where: { key } });
      } else {
        await prisma.globalSetting.upsert({
          where: { key },
          update: { value: value.trim() },
          create: { key, value: value.trim() },
        });
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed";
    if (msg === "Unauthorized") return NextResponse.json({ error: msg }, { status: 401 });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
