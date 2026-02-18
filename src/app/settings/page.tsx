import { redirect } from "next/navigation";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import NavShell from "@/components/NavShell";
import SettingsForm from "@/components/SettingsForm";

export default async function SettingsPage() {
  const email = await getAuthEmail();
  if (!isFleetAdmin(email)) redirect("/");

  const domain = process.env.BASE_DOMAIN || "not set";

  return (
    <NavShell isAdmin>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
          <p className="text-zinc-500 mt-1 text-sm">Fleet configuration overview</p>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6">
          <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-3">Domain</h2>
          <p className="font-mono text-sm text-zinc-200">{domain}</p>
          <p className="text-xs text-zinc-500 mt-1.5">Tenants accessible at <span className="font-mono text-zinc-400">[slug].{domain}</span></p>
        </div>

        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-6">
          <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium mb-1.5">API Keys</h2>
          <p className="text-xs text-zinc-500 mb-4">
            Manage global API keys. Keys stored in the database take priority over environment variables.
          </p>
          <SettingsForm />
        </div>
      </div>
    </NavShell>
  );
}
