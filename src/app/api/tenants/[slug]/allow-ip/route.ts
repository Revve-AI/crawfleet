import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/tenant-access";
import { connectWithRetry, execSSH, escapeForBash } from "@/lib/providers/ssh";
import { apiError } from "@/lib/api-error";

type Params = { params: Promise<{ slug: string }> };

function getClientIp(req: NextRequest): string | null {
  return (
    req.headers.get("cf-connecting-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    null
  );
}

/** Add caller's public IP to the tenant VM's SSH firewall allowlist. */
export async function POST(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    const vps = tenant.vps_instances;
    if (!vps?.external_ip) {
      return NextResponse.json({ error: "VPS not ready" }, { status: 400 });
    }

    const userIp = getClientIp(req);
    if (!userIp) {
      return NextResponse.json({ error: "Could not detect your IP" }, { status: 400 });
    }

    const script = `#!/bin/bash
set -euo pipefail
ufw allow from ${userIp} to any port 22 comment 'user-ip'
ufw reload
echo "Allowed ${userIp}"
`;

    const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user });
    try {
      const result = await execSSH(conn, `sudo bash -c ${escapeForBash(script)}`, 15_000);
      if (result.code !== 0) {
        throw new Error(`UFW failed: ${result.stderr}`);
      }
    } finally {
      conn.end();
    }

    return NextResponse.json({ success: true, data: { ip: userIp } });
  } catch (e) {
    return apiError(e);
  }
}

/** Remove caller's public IP from the tenant VM's SSH firewall allowlist. */
export async function DELETE(req: NextRequest, { params }: Params) {
  try {
    const { slug } = await params;
    const tenant = await requireTenantAccess(slug);
    const vps = tenant.vps_instances;
    if (!vps?.external_ip) {
      return NextResponse.json({ error: "VPS not ready" }, { status: 400 });
    }

    const userIp = getClientIp(req);
    if (!userIp) {
      return NextResponse.json({ error: "Could not detect your IP" }, { status: 400 });
    }

    const script = `#!/bin/bash
set -euo pipefail
ufw delete allow from ${userIp} to any port 22 || true
ufw reload
echo "Removed ${userIp}"
`;

    const conn = await connectWithRetry({ host: vps.external_ip, username: vps.ssh_user });
    try {
      await execSSH(conn, `sudo bash -c ${escapeForBash(script)}`, 15_000);
    } finally {
      conn.end();
    }

    return NextResponse.json({ success: true, data: { ip: userIp } });
  } catch (e) {
    return apiError(e);
  }
}
