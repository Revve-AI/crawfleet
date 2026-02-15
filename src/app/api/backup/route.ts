import { NextResponse } from "next/server";
import { requireFleetAdmin } from "@/lib/auth";
import { backupAllTenants } from "@/lib/backup";
import { BACKUP_BUCKET } from "@/lib/constants";
import { apiError } from "@/lib/api-error";

export async function POST() {
  try {
    await requireFleetAdmin();

    if (!BACKUP_BUCKET) {
      return NextResponse.json(
        { error: "BACKUP_BUCKET not configured" },
        { status: 503 }
      );
    }

    // Run backup in background, return immediately
    backupAllTenants().catch((err) =>
      console.error("[backup] Manual trigger failed:", err)
    );

    return NextResponse.json({
      success: true,
      message: "Backup started",
      bucket: BACKUP_BUCKET,
    });
  } catch (e) {
    return apiError(e);
  }
}
