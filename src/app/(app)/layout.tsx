import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { InstallPrompt } from "./install-prompt";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // SÓ O QUE O MENU USA (velocidade, 20/08/2026).
  //
  // Este layout roda em TODA navegação do app. Ele lia a ficha INTEIRA da
  // loja — inclusive o `logoUrl`, que na maioria das lojas é a imagem em
  // base64 dentro do banco (dívida técnica nº 1). Ou seja: cada troca de
  // tela arrastava o logo inteiro do banco para ler cinco chavinhas de
  // módulo. E ainda consultava o usuário DE NOVO, só para saber o tema e a
  // foto — que agora vêm junto com a sessão.
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: {
      name: true,
      productionEnabled: true,
      cutPlanEnabled: true,
      marketingEnabled: true,
      mediaLibraryEnabled: true,
      aiSalesEnabled: true,
      shippingEnabled: true,
    },
  });
  const dark = user.prefersDark;

  return (
    <div className={dark ? "theme-dark min-h-dvh" : undefined}>
      <AppShell
        user={{
          name: user.name,
          role: user.role,
          roleLabel: roleLabel[user.role],
          color: user.color,
          companyName: company?.name ?? "",
          avatarUrl: user.avatarUrl,
          impersonating: Boolean(user.impersonatedBy),
          productionEnabled: company?.productionEnabled ?? false,
          cutPlanEnabled: company?.cutPlanEnabled ?? false,
          shippingEnabled: company?.shippingEnabled ?? false,
          marketingEnabled: company?.marketingEnabled ?? false,
          mediaLibraryEnabled: company?.mediaLibraryEnabled ?? false,
          aiSalesEnabled: company?.aiSalesEnabled ?? false,
          prefersDark: dark,
        }}
      >
        {children}
        <InstallPrompt />
      </AppShell>
    </div>
  );
}
