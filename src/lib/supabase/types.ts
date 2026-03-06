export interface Tenant {
  id: string;
  user_id: string | null;
  slug: string;
  display_name: string;
  email: string | null;
  enabled: boolean;
  status: string;
  access_mode: "private" | "funnel";
  access_app_id: string | null;
  tailscale_api_key: string | null;
  tailscale_tailnet: string | null;
  env_overrides: Record<string, string> | null;
  gateway_token: string;
  user_ssh_public_key: string | null;
  last_health_check: string | null;
  last_health_status: string | null;
  created_at: string;
  updated_at: string;
}

export interface VpsInstance {
  id: string;
  tenant_id: string;
  cloud: string;
  region: string;
  instance_id: string;
  machine_type: string;
  external_ip: string | null;
  tunnel_id: string | null;
  tunnel_token: string | null;
  tailscale_device_id: string | null;
  tailscale_ip: string | null;
  tailscale_hostname: string | null;
  git_tag: string | null;
  ssh_user: string;
  ssh_port: number;
  vm_status: string;
  provision_stage: string | null;
  created_at: string;
  updated_at: string;
}

export interface GlobalSetting {
  key: string;
  value: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  tenant_id: string | null;
  action: string;
  details: Record<string, unknown> | null;
  created_at: string;
}

export type TenantWithVps = Tenant & { vps_instances: VpsInstance };
