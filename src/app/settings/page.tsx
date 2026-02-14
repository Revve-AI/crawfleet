import NavShell from "@/components/NavShell";
import SettingsForm from "@/components/SettingsForm";

export default async function SettingsPage() {
  const domain = process.env.BASE_DOMAIN || "not set";

  return (
    <NavShell>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold">Settings</h1>
          <p className="text-gray-500 mt-1">Fleet configuration overview</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">Domain</h2>
          <p className="font-mono text-sm text-gray-300">{domain}</p>
          <p className="text-xs text-gray-500 mt-1">Tenants accessible at [slug].{domain}</p>
        </div>

        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <h2 className="text-lg font-semibold mb-4">API Keys</h2>
          <p className="text-xs text-gray-500 mb-4">
            Manage global API keys. Keys stored in the database take priority over environment variables.
          </p>
          <SettingsForm />
        </div>
      </div>
    </NavShell>
  );
}
