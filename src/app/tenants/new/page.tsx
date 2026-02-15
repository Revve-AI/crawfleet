import { redirect } from "next/navigation";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import NavShell from "@/components/NavShell";
import TenantForm from "@/components/TenantForm";

export default async function NewTenantPage() {

  const email = await getAuthEmail();
  if (!isFleetAdmin(email)) redirect("/tenants");

  return (
    <NavShell isAdmin>
      <div className="space-y-6">
        <div>
          <a href="/tenants" className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1 mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            Tenants
          </a>
          <h1 className="text-2xl font-bold tracking-tight">Create Tenant</h1>
          <p className="text-zinc-500 mt-1 text-sm">Provision a new OpenClaw instance</p>
        </div>
        <TenantForm mode="create" />
      </div>
    </NavShell>
  );
}
