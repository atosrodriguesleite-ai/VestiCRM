import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { ProducaoTabs } from "./tabs";

/**
 * Módulo Produção (pago à parte): sem a chave productionEnabled ligada pelo
 * Super Admin, a loja nem chega a ver estas telas.
 */
export default async function ProducaoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { productionEnabled: true },
  });
  if (!company?.productionEnabled) redirect("/dashboard");

  return (
    <div className="max-w-7xl mx-auto">
      <ProducaoTabs />
      {children}
    </div>
  );
}
