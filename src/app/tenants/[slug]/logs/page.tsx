import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import NavShell from "@/components/NavShell";
import ContainerLogs from "@/components/ContainerLogs";

export const dynamic = "force-dynamic";

export default async function LogsPage({ params }: { params: Promise<{ slug: string }> }) {

  const { slug } = await params;
  const tenant = await prisma.tenant.findUnique({ where: { slug } });
  if (!tenant) notFound();

  return (
    <NavShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">{tenant.displayName} — Logs</h1>
          <p className="text-gray-500 mt-1">Live container output for {tenant.slug}</p>
        </div>
        <ContainerLogs slug={slug} />
      </div>
    </NavShell>
  );
}
