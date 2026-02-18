import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getAuthEmail, isFleetAdmin } from "@/lib/auth";
import ContainerShell from "@/components/ContainerShell";
import ShellCloseButton from "./ShellCloseButton";

export const dynamic = "force-dynamic";

export default async function ShellPage({ params }: { params: Promise<{ slug: string }> }) {

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
    <div className="h-screen flex flex-col bg-zinc-950">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800/60 shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-5 h-5 rounded bg-brand/80 flex items-center justify-center">
            <svg width="10" height="10" viewBox="0 0 20 20" fill="none">
              <path d="M3 14l5-8 5 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
              <path d="M7 14l5-8 5 8" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <span className="text-sm font-medium text-zinc-300">
            {tenant.display_name} <span className="text-zinc-600">&mdash;</span> Shell
          </span>
        </div>
        <ShellCloseButton />
      </div>
      <div className="flex-1 min-h-0 p-2">
        <ContainerShell slug={slug} />
      </div>
    </div>
  );
}
