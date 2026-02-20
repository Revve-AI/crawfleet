import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import { CLOUDFLARE_DOMAIN } from "@/lib/constants";
import NavShell from "@/components/NavShell";
import SshKeyForm from "@/components/SshKeyForm";

export const dynamic = "force-dynamic";

export default async function SshPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const email = await getAuthEmail();
  const admin = isFleetAdmin(email);
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("slug, display_name, email, user_ssh_public_key, vps_instances(ssh_user)")
    .eq("slug", slug)
    .single();
  if (!tenant) notFound();
  if (!admin && tenant.email !== email) notFound();

  const vps = Array.isArray(tenant.vps_instances) ? tenant.vps_instances[0] : tenant.vps_instances;
  const sshUser = vps?.ssh_user || "openclaw";
  const sshHost = `ssh-${slug}.${CLOUDFLARE_DOMAIN}`;

  return (
    <NavShell isAdmin={admin}>
      <div className="space-y-6">
        <div>
          <a href={`/tenants/${slug}`} className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors inline-flex items-center gap-1 mb-3">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
            {tenant.display_name}
          </a>
          <h1 className="text-2xl font-bold tracking-tight">SSH Access</h1>
          <p className="text-zinc-500 mt-1 text-sm">Connect to <span className="font-mono text-zinc-400">{tenant.slug}</span> via SSH through Cloudflare Tunnel</p>
        </div>

        {/* SSH Key */}
        <SshKeyForm slug={slug} existingKey={tenant.user_ssh_public_key} />

        {/* Instructions */}
        <div className="bg-zinc-900/80 border border-zinc-800/60 rounded-xl p-5 space-y-5">
          <h2 className="text-[11px] text-zinc-500 uppercase tracking-wider font-medium">Setup Instructions</h2>

          <div className="space-y-4">
            <Step n={1} title="Install cloudflared">
              <Code>{`# macOS
brew install cloudflared

# Linux (Debian/Ubuntu)
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg > /dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install cloudflared`}</Code>
            </Step>

            <Step n={2} title="Add to your SSH config">
              <p className="text-zinc-400 text-sm mb-2">Add this to <code className="text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded text-xs">~/.ssh/config</code>:</p>
              <Code>{`Host ${sshHost}
  ProxyCommand cloudflared access ssh --hostname %h
  User ${sshUser}`}</Code>
            </Step>

            <Step n={3} title="Connect">
              <Code>{`ssh ${sshHost}`}</Code>
            </Step>
          </div>
        </div>
      </div>
    </NavShell>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-zinc-800 text-[11px] font-medium text-zinc-400 border border-zinc-700/60">{n}</span>
        <h3 className="text-sm font-medium text-zinc-200">{title}</h3>
      </div>
      <div className="ml-7">{children}</div>
    </div>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="bg-zinc-950 border border-zinc-800/60 rounded-lg p-3 text-xs font-mono text-zinc-300 overflow-x-auto whitespace-pre select-all">
      {children}
    </pre>
  );
}
