import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Módulo Plano de Corte (pago à parte, independente da Produção): sem a
 * chave cutPlanEnabled ligada pelo Super Admin, a loja nem vê estas telas.
 */
export default async function PlanoCorteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { cutPlanEnabled: true },
  });
  if (!company?.cutPlanEnabled) redirect("/dashboard");
  // Suporte não opera a mesa de corte
  if (user.role === "SUPPORT") redirect("/pedidos");

  return <div className="max-w-7xl mx-auto">{children}</div>;
}
