import { InstancesClient } from "@google-cloud/compute";
import type { CloudProvider, VmSpec, VmInfo } from "./types";
import { GCP_PROJECT } from "../constants";

let _instances: InstancesClient | null = null;

function getInstancesClient(): InstancesClient {
  if (_instances) return _instances;

  const saKey = process.env.GCP_SERVICE_ACCOUNT_KEY;
  const credFile = process.env.GCP_CREDENTIALS_FILE;

  if (saKey) {
    // Inline service account key — raw JSON or base64-encoded
    const json = saKey.trim().startsWith("{")
      ? saKey
      : Buffer.from(saKey, "base64").toString("utf-8");
    const credentials = JSON.parse(json);
    _instances = new InstancesClient({ credentials, projectId: GCP_PROJECT || undefined });
  } else if (credFile) {
    // File path — SA key or WIF config
    _instances = new InstancesClient({ keyFilename: credFile, projectId: GCP_PROJECT || undefined });
  } else {
    // ADC fallback (metadata service, GOOGLE_APPLICATION_CREDENTIALS, gcloud CLI)
    _instances = new InstancesClient();
  }

  return _instances;
}

/** Wait for a GCP LRO to complete. For mutating ops, waits a fixed delay. */
async function waitForOperation(op: { done?: boolean | null }) {
  if (op.done) return;
  await new Promise((r) => setTimeout(r, 5_000));
}

export class GcpCloudProvider implements CloudProvider {
  async createVm(spec: VmSpec): Promise<string> {
    const [operation] = await getInstancesClient().insert({
      project: GCP_PROJECT,
      zone: spec.region,
      instanceResource: {
        name: spec.name,
        machineType: `zones/${spec.region}/machineTypes/${spec.machineType}`,
        disks: [
          {
            boot: true,
            autoDelete: true,
            initializeParams: {
              sourceImage: "projects/debian-cloud/global/images/family/debian-12",
              diskSizeGb: "30",
            },
          },
        ],
        networkInterfaces: [
          {
            network: "global/networks/default",
            accessConfigs: [{ type: "ONE_TO_ONE_NAT", name: "External NAT" }],
          },
        ],
        metadata: {
          items: [
            { key: "ssh-keys", value: `openclaw:${spec.sshPublicKey}` },
            ...(spec.startupScript
              ? [{ key: "startup-script", value: spec.startupScript }]
              : []),
          ],
        },
        tags: { items: spec.tags ?? ["fleet-vps"] },
        serviceAccounts: [
          {
            email: "default",
            scopes: ["https://www.googleapis.com/auth/logging.write"],
          },
        ],
      },
    });

    // Don't block on operation — waitForReady() will poll instance status
    if (!operation.done) {
      await new Promise((r) => setTimeout(r, 3_000));
    }

    return spec.name;
  }

  async waitForReady(
    instanceId: string,
    region: string,
    timeoutMs = 300_000,
  ): Promise<string> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const info = await this.getVmInfo(instanceId, region);
      if (info.status === "running" && info.externalIp) {
        // Wait a bit for SSH to come up after VM reports running
        await new Promise((r) => setTimeout(r, 10_000));
        return info.externalIp;
      }
      await new Promise((r) => setTimeout(r, 5_000));
    }

    throw new Error(`VM ${instanceId} did not become ready within ${timeoutMs}ms`);
  }

  async startVm(instanceId: string, region: string): Promise<void> {
    const [operation] = await getInstancesClient().start({
      project: GCP_PROJECT,
      zone: region,
      instance: instanceId,
    });
    await waitForOperation(operation);
  }

  async stopVm(instanceId: string, region: string): Promise<void> {
    const [operation] = await getInstancesClient().stop({
      project: GCP_PROJECT,
      zone: region,
      instance: instanceId,
    });
    await waitForOperation(operation);
  }

  async deleteVm(instanceId: string, region: string): Promise<void> {
    const [operation] = await getInstancesClient().delete({
      project: GCP_PROJECT,
      zone: region,
      instance: instanceId,
    });
    await waitForOperation(operation);
  }

  async getVmInfo(instanceId: string, region: string): Promise<VmInfo> {
    try {
      const [instance] = await getInstancesClient().get({
        project: GCP_PROJECT,
        zone: region,
        instance: instanceId,
      });

      const gcpStatus = instance.status?.toUpperCase();
      let status: VmInfo["status"];
      switch (gcpStatus) {
        case "RUNNING":
          status = "running";
          break;
        case "TERMINATED":
        case "STOPPED":
        case "SUSPENDED":
          status = "stopped";
          break;
        case "PROVISIONING":
        case "STAGING":
          status = "creating";
          break;
        default:
          status = "unknown";
      }

      const accessConfig = instance.networkInterfaces?.[0]?.accessConfigs?.[0];
      const externalIp = accessConfig?.natIP ?? null;

      return { instanceId, externalIp, status };
    } catch {
      return { instanceId, externalIp: null, status: "error" };
    }
  }

  async listMachineTypes(): Promise<Array<{ id: string; description: string }>> {
    return [
      { id: "e2-micro", description: "e2-micro (2 vCPU, 1 GB) — ~$7/mo" },
      { id: "e2-small", description: "e2-small (2 vCPU, 2 GB) — ~$14/mo" },
      { id: "e2-medium", description: "e2-medium (2 vCPU, 4 GB) — ~$27/mo" },
      { id: "e2-standard-2", description: "e2-standard-2 (2 vCPU, 8 GB) — ~$49/mo" },
      { id: "e2-standard-4", description: "e2-standard-4 (4 vCPU, 16 GB) — ~$97/mo" },
    ];
  }

  async listRegions(): Promise<Array<{ id: string; description: string }>> {
    return [
      { id: "us-central1-a", description: "Iowa, US" },
      { id: "us-east1-b", description: "South Carolina, US" },
      { id: "us-west1-a", description: "Oregon, US" },
      { id: "europe-west1-b", description: "Belgium, EU" },
      { id: "europe-west4-a", description: "Netherlands, EU" },
      { id: "asia-southeast1-a", description: "Singapore" },
      { id: "asia-east1-a", description: "Taiwan" },
    ];
  }
}
