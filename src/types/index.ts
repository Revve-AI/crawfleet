export interface TenantCreateInput {
  slug: string;
  displayName: string;
  email: string;
  allowAnthropic?: boolean;
  allowOpenAI?: boolean;
  allowGemini?: boolean;
  allowBrave?: boolean;
  allowElevenLabs?: boolean;
  defaultModel?: string;
  execSecurity?: string;
  browserEnabled?: boolean;
  envOverrides?: Record<string, string>;
}

export interface TenantUpdateInput {
  displayName?: string;
  enabled?: boolean;
  allowAnthropic?: boolean;
  allowOpenAI?: boolean;
  allowGemini?: boolean;
  allowBrave?: boolean;
  allowElevenLabs?: boolean;
  defaultModel?: string;
  execSecurity?: string;
  browserEnabled?: boolean;
  envOverrides?: Record<string, string>;
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
