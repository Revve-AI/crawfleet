export interface TenantCreateInput {
  slug: string;
  displayName: string;
  email: string;
  envOverrides?: Record<string, string>;
  cloud: string;
  machineType: string;
  region: string;
  gitTag?: string;
  sshPublicKey?: string;
  accessMode?: "private" | "funnel";
  tailscaleApiKey?: string;
  tailscaleTailnet?: string;
}

export interface TenantUpdateInput {
  displayName?: string;
  enabled?: boolean;
  envOverrides?: Record<string, string>;
  accessMode?: "private" | "funnel";
}

export interface FleetStats {
  total: number;
  running: number;
  stopped: number;
  healthy: number;
  unhealthy: number;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}
