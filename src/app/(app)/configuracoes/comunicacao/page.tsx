import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/lib/auth";
import { isAdmin } from "@/lib/scope";
import { PageHeader } from "@/components/ui";
import { CommSettingsForm } from "./comm-settings-form";

export const dynamic = "force-dynamic";

export default async function CommSettingsPage() {
  const user = await requireUser();
  if (!isAdmin(user)) redirect("/configuracoes");

  return (
    <div className="max-w-4xl mx-auto">
      <Link
        href="/configuracoes"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-brand-600 mb-4 transition"
      >
        <ArrowLeft className="size-4" />
        Configurações
      </Link>
      <PageHeader
        title="Comunicação"
        subtitle="Credenciais dos canais. Nada é ativado ainda — ao preencher as credenciais oficiais, troque o provider e tudo passa a funcionar sem alterar nenhuma tela."
      />
      <CommSettingsForm />
    </div>
  );
}
