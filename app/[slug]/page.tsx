import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getTenant, toPublico } from "@/lib/tenants";
import Painel from "@/components/Painel";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tenant = getTenant(slug);
  return { title: tenant?.titulo || "Painel de Leads" };
}

export default async function PaginaTenant({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const tenant = getTenant(slug);
  if (!tenant) notFound();

  return <Painel tenant={toPublico(tenant)} />;
}
