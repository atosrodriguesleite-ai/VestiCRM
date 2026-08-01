import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { RecoveryBoard } from "./recovery-board";

export const dynamic = "force-dynamic";

/**
 * RECUPERAÇÃO — a esteira dos carrinhos abandonados (catálogo + Nuvemshop).
 * A tela é toda cliente (a lista vive mudando); os dados vêm da API, que
 * também dá carona na varredura ao ser aberta.
 */
export default async function RecuperacaoPage() {
  const user = await requireUser();
  if (user.role === "SUPPORT") redirect("/dashboard");
  return <RecoveryBoard />;
}
