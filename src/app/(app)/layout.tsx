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

  const [company, dbUser] = await Promise.all([
    db.company.findUnique({ where: { id: user.companyId } }),
    // preferência de tema é individual e vem do banco (vale em qualquer aparelho)
    db.user.findUnique({ where: { id: user.id }, select: { prefersDark: true } }),
  ]);
  const dark = dbUser?.prefersDark ?? false;

  return (
    <div className={dark ? "theme-dark min-h-dvh" : undefined}>
      <AppShell
        user={{
          name: user.name,
          role: user.role,
          roleLabel: roleLabel[user.role],
          color: user.color,
          companyName: company?.name ?? "",
          impersonating: Boolean(user.impersonatedBy),
          productionEnabled: company?.productionEnabled ?? false,
          prefersDark: dark,
        }}
      >
        {children}
        <InstallPrompt />
      </AppShell>
    </div>
  );
}
