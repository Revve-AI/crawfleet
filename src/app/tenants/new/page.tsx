import NavShell from "@/components/NavShell";
import TenantForm from "@/components/TenantForm";

export default async function NewTenantPage() {

  return (
    <NavShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Create Tenant</h1>
          <p className="text-gray-500 mt-1">Provision a new OpenClaw instance</p>
        </div>
        <TenantForm mode="create" />
      </div>
    </NavShell>
  );
}
