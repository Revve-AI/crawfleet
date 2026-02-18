import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import NavShell from "@/components/NavShell";
import ContainerLogs from "@/components/ContainerLogs";

export const dynamic = "force-dynamic";

export default async function LogsPage({ params }: { params: Promise<{ slug: string }> }) {

  const { slug } = await params;
  const email = await getAuthEmail();
  const admin = isFleetAdmin(email);
  const { data: tenant } = await supabaseAdmin
    .from("tenants")
    .select("slug, display_name, email")
    .eq("slug", slug)
    .single();
  if (!tenant) notFound();
  if (!admin && tenant.email !== email) notFound();

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
          <h1 className="text-2xl font-bold tracking-tight">Logs</h1>
          <p className="text-zinc-500 mt-1 text-sm">Live container output for <span className="font-mono text-zinc-400">{tenant.slug}</span></p>
        </div>
        <ContainerLogs slug={slug} />
      </div>
    </NavShell>
  );
}
