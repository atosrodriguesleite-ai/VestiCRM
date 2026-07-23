import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { BibliotecaView } from "./biblioteca-view";

/**
 * Biblioteca de imagens — recurso gated (mediaLibraryEnabled). Guarda fotos
 * soltas da loja (reaproveitar, salvar antes de excluir um produto, etc).
 */
export default async function BibliotecaPage() {
  const user = await requireUser();
  const company = await db.company.findUnique({
    where: { id: user.companyId },
    select: { mediaLibraryEnabled: true },
  });
  if (!company?.mediaLibraryEnabled) redirect("/dashboard");

  const assets = await db.mediaAsset.findMany({
    where: { companyId: user.companyId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, createdAt: true },
    take: 500,
  });

  return (
    <BibliotecaView
      initial={assets.map((a) => ({
        id: a.id,
        name: a.name,
        createdAt: a.createdAt.toISOString(),
      }))}
    />
  );
}
