import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import type { TenantWithVps } from "@/lib/supabase/types";

/**
 * Load a tenant by slug (with VPS instance), enforcing that the current
 * user owns it (or is a fleet admin). Throws typed errors for the API error handler.
 */
export async function requireTenantAccess(slug: string): Promise<TenantWithVps> {
  const email = await getAuthEmail();
  const { data: tenant, error } = await supabaseAdmin
    .from("tenants")
    .select("*, vps_instances(*)")
    .eq("slug", slug)
    .single();

  if (error || !tenant) throw new Error("NotFound");
  if (!isFleetAdmin(email) && tenant.email !== email) throw new Error("Forbidden");
  return tenant as TenantWithVps;
}
