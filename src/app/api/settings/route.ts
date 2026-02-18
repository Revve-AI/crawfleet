import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireFleetAdmin } from "@/lib/auth";
import { apiError } from "@/lib/api-error";

function mask(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "..." + value.slice(-4);
}

export async function GET() {
  try {
    await requireFleetAdmin();

    const { data: settings } = await supabaseAdmin
      .from("global_settings")
      .select("*")
      .order("key", { ascending: true });

    const data = (settings || []).map((s) => ({
      key: s.key,
      masked: mask(s.value),
      updatedAt: s.updated_at,
    }));

    return NextResponse.json({ success: true, data });
  } catch (e) {
    return apiError(e);
  }
}

export async function PUT(req: NextRequest) {
  try {
    await requireFleetAdmin();
    const body: Record<string, string> = await req.json();

    for (const [key, value] of Object.entries(body)) {
      if (!key.trim()) continue;

      if (!value || value.trim() === "") {
        await supabaseAdmin
          .from("global_settings")
          .delete()
          .eq("key", key);
      } else {
        await supabaseAdmin
          .from("global_settings")
          .upsert(
            { key, value: value.trim() },
            { onConflict: "key" },
          );
      }
    }

    return NextResponse.json({ success: true });
  } catch (e) {
    return apiError(e);
  }
}
