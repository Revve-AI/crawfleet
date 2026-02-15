import { prisma } from "@/lib/db";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import type { Tenant } from "@prisma/client";

/**
 * Load a tenant by slug, enforcing that the current user owns it
 * (or is a fleet admin). Throws typed errors for the API error handler.
 */
export async function requireTenantAccess(slug: string): Promise<Tenant> {
  const email = await getAuthEmail();
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) throw new Error("NotFound");
  if (!isFleetAdmin(email) && tenant.email !== email) throw new Error("Forbidden");
  return tenant;
}
