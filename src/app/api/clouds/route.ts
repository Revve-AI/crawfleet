import { NextResponse } from "next/server";
import { requireFleetAdmin } from "@/lib/auth";
import { listAvailableClouds, getCloudProvider } from "@/lib/clouds";
import { apiError } from "@/lib/api-error";

export async function GET() {
  try {
    await requireFleetAdmin();

    const clouds = listAvailableClouds();
    const result = await Promise.all(
      clouds.map(async (cloud) => {
        const provider = getCloudProvider(cloud.id);
        const [regions, machineTypes] = await Promise.all([
          provider.listRegions(),
          provider.listMachineTypes(""),
        ]);
        return { ...cloud, regions, machineTypes };
      }),
    );

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    return apiError(e);
  }
}
