import type { TenantWithVps } from "@/lib/supabase/types";
import { Duplex } from "stream";

export type StatusCallback = (step: string) => void;
export type { TenantWithVps };

export const PROVISION_STAGES = [
  "vm_created",
  "vm_ready",
  "vm_setup",
  "tunnel_created",
  "cloudflared_installed",
  "service_started",
  "health_checked",
  "locked_down",
] as const;

export type ProvisionStage = (typeof PROVISION_STAGES)[number];

export class PartialProvisioningError extends Error {
  completedStage: ProvisionStage;
  failedStep: string;
  cause: Error;

  constructor(completedStage: ProvisionStage, failedStep: string, cause: Error) {
    super(`Provisioning failed at "${failedStep}" (completed: ${completedStage}): ${cause.message}`);
    this.name = "PartialProvisioningError";
    this.completedStage = completedStage;
    this.failedStep = failedStep;
    this.cause = cause;
  }
}

export interface ShellHandle {
  stream: Duplex;
  resize(cols: number, rows: number): Promise<void>;
  destroy(): void;
}

export interface TenantProvider {
  create(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<string>;
  resume(tenant: TenantWithVps, onStatus?: StatusCallback): Promise<void>;
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
