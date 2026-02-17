import { Tenant, VpsInstance } from "@prisma/client";
import { Duplex } from "stream";

export type StatusCallback = (step: string) => void;
export type TenantWithVps = Tenant & { vpsInstance: VpsInstance | null };

export interface ShellHandle {
  stream: Duplex;
  resize(cols: number, rows: number): Promise<void>;
  destroy(): void;
}

export interface TenantProvider {
  create(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string>;
  start(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<void>;
  stop(tenant: TenantWithVps): Promise<void>;
  restart(tenant: TenantWithVps): Promise<void>;
  remove(tenant: TenantWithVps): Promise<void>;
  deploy(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string>;
  getStatus(tenant: TenantWithVps): Promise<string>;
  getHealth(tenant: TenantWithVps): Promise<string>;
  waitForHealthy(tenant: TenantWithVps, timeoutMs: number, onStatus?: StatusCallback): Promise<boolean>;
  getLogs(tenant: TenantWithVps, tail: number): Promise<NodeJS.ReadableStream>;
  execShell(tenant: TenantWithVps): Promise<ShellHandle>;
  removeTenantData(tenant: TenantWithVps): Promise<void>;
}
