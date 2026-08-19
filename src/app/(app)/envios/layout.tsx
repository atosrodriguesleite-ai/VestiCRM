import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";

/**
 * Módulo Envios (pago à parte): sem a chave shippingEnabled ligada pelo
 * Super Admin, a loja nem vê esta tela. Suporte ENTRA — despachar caixa e
 * conferir rastreio é operação, não venda.
 */
export default async function EnviosLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { shippingEnabled: true },
  });
  if (!company?.shippingEnabled) redirect("/dashboard");

  return <div className="max-w-7xl mx-auto">{children}</div>;
}
