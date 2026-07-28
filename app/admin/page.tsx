import type { Metadata } from "next";
import Admin from "@/components/Admin";

export const metadata: Metadata = { title: "Administração — Painel de Leads" };

export default function PaginaAdmin() {
  return <Admin />;
}