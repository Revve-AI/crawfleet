import type { CloudProvider, VmSpec, VmInfo } from "./types";

const API_BASE = "https://api.hetzner.cloud/v1";

function getToken(): string {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("HETZNER_API_TOKEN is not set");
  return token;
}

async function hetznerFetch(
  path: string,
  opts: RequestInit = {},
): Promise<Response> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Hetzner API ${res.status}: ${body}`);
  }
  return res;
}

export class HetznerCloudProvider implements CloudProvider {
  async createVm(spec: VmSpec): Promise<string> {
    const res = await hetznerFetch("/servers", {
      method: "POST",
      body: JSON.stringify({
        name: spec.name,
        server_type: spec.machineType,
        location: spec.region,
        image: "debian-12",
        ssh_keys: [], // We inject the key via user_data instead
        user_data: this.buildUserData(spec),
        labels: { fleet: "true" },
        public_net: { enable_ipv4: true, enable_ipv6: true },
      }),
    });

    const data = await res.json();
    return String(data.server.id);
  }

  async waitForReady(
    instanceId: string,
    region: string,
    timeoutMs = 300_000,
  ): Promise<string> {
    void region;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const info = await this.getVmInfo(instanceId, "");
      if (info.status === "running" && info.externalIp) {
        // Wait for SSH to come up after server reports running
        await new Promise((r) => setTimeout(r, 10_000));
        return info.externalIp;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }

    throw new Error(
      `Hetzner server ${instanceId} did not become ready within ${timeoutMs}ms`,
    );
  }

  async startVm(instanceId: string, _region: string): Promise<void> {
    await hetznerFetch(`/servers/${instanceId}/actions/poweron`, {
      method: "POST",
    });
  }

  async stopVm(instanceId: string, _region: string): Promise<void> {
    await hetznerFetch(`/servers/${instanceId}/actions/shutdown`, {
      method: "POST",
    });
  }

  async deleteVm(instanceId: string, _region: string): Promise<void> {
    await hetznerFetch(`/servers/${instanceId}`, { method: "DELETE" });
  }

  async getVmInfo(instanceId: string, _region: string): Promise<VmInfo> {
    try {
      const res = await hetznerFetch(`/servers/${instanceId}`);
      const { server } = await res.json();

      let status: VmInfo["status"];
      switch (server.status) {
        case "running":
          status = "running";
          break;
        case "off":
          status = "stopped";
          break;
        case "initializing":
        case "starting":
        case "rebuilding":
          status = "creating";
          break;
        default:
          status = "unknown";
      }

      const externalIp: string | null =
        server.public_net?.ipv4?.ip ?? null;

      return { instanceId, externalIp, status };
    } catch {
      return { instanceId, externalIp: null, status: "error" };
    }
  }

  async listMachineTypes(_region: string): Promise<
    Array<{ id: string; description: string }>
  > {
    // Arm64 (Ampere) types — confirmed compatible
    return [
      { id: "cax11", description: "CAX11 (2 vCPU Arm, 4 GB) — ~€4/mo" },
      { id: "cax21", description: "CAX21 (4 vCPU Arm, 8 GB) — ~€7/mo" },
      { id: "cax31", description: "CAX31 (8 vCPU Arm, 16 GB) — ~€14/mo" },
      { id: "cax41", description: "CAX41 (16 vCPU Arm, 32 GB) — ~€28/mo" },
      { id: "cx22", description: "CX22 (2 vCPU x86, 4 GB) — ~€4/mo" },
      { id: "cx32", description: "CX32 (4 vCPU x86, 8 GB) — ~€8/mo" },
      { id: "cx42", description: "CX42 (8 vCPU x86, 16 GB) — ~€16/mo" },
      { id: "cx52", description: "CX52 (16 vCPU x86, 32 GB) — ~€31/mo" },
    ];
  }

  async listRegions(): Promise<Array<{ id: string; description: string }>> {
    return [
      { id: "fsn1", description: "Falkenstein, Germany" },
      { id: "nbg1", description: "Nuremberg, Germany" },
      { id: "hel1", description: "Helsinki, Finland" },
      { id: "ash", description: "Ashburn, US" },
      { id: "hil", description: "Hillsboro, US" },
      { id: "sin", description: "Singapore" },
    ];
  }

  private buildUserData(spec: VmSpec): string {
    // cloud-init script: inject SSH key and run startup script if provided
    const lines = [
      "#!/bin/bash",
      "set -euo pipefail",
      "",
      "# Inject SSH public key",
      "mkdir -p /home/openclaw/.ssh",
      `echo '${spec.sshPublicKey}' >> /home/openclaw/.ssh/authorized_keys`,
      "chmod 700 /home/openclaw/.ssh",
      "chmod 600 /home/openclaw/.ssh/authorized_keys",
      "",
      "# Also add to root for initial provisioning",
      "mkdir -p /root/.ssh",
      `echo '${spec.sshPublicKey}' >> /root/.ssh/authorized_keys`,
      "chmod 700 /root/.ssh",
      "chmod 600 /root/.ssh/authorized_keys",
    ];

    if (spec.startupScript) {
      lines.push("", "# Startup script", spec.startupScript);
    }

    return lines.join("\n");
  }
}
