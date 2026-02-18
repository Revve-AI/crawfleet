export interface Tenant {
  id: string;
  user_id: string | null;
  slug: string;
  display_name: string;
  email: string | null;
  enabled: boolean;
  container_id: string | null;
  container_status: string;
  access_app_id: string | null;
  image: string | null;
  env_overrides: Record<string, string> | null;
  gateway_token: string;
  provider: string;
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
  git_tag: string | null;
  ssh_user: string;
  ssh_port: number;
  vm_status: string;
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

export type TenantWithVps = Tenant & { vps_instances: VpsInstance | null };
