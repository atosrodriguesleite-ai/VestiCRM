import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { roleLabel } from "@/lib/format";
import { AppShell } from "@/components/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const company = await db.company.findUnique({
    where: { id: user.companyId },
  });

  return (
    <AppShell
      user={{
        name: user.name,
        role: user.role,
        roleLabel: roleLabel[user.role],
        color: user.color,
        companyName: company?.name ?? "",
      }}
    >
      {children}
    </AppShell>
  );
}
