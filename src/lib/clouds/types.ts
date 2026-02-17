export interface VmSpec {
  name: string;
  machineType: string;
  region: string;
  sshPublicKey: string;
  startupScript?: string;
  tags?: string[];
}

export interface VmInfo {
  instanceId: string;
  externalIp: string | null;
  status: "running" | "stopped" | "creating" | "error" | "unknown";
}

export interface CloudProvider {
  createVm(spec: VmSpec): Promise<string>;
  waitForReady(instanceId: string, region: string, timeoutMs?: number): Promise<string>;
  startVm(instanceId: string, region: string): Promise<void>;
  stopVm(instanceId: string, region: string): Promise<void>;
  deleteVm(instanceId: string, region: string): Promise<void>;
  getVmInfo(instanceId: string, region: string): Promise<VmInfo>;
  listMachineTypes(region: string): Promise<Array<{ id: string; description: string }>>;
  listRegions(): Promise<Array<{ id: string; description: string }>>;
}
