import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { dadosDaAbaRecompra } from "@/lib/recompra";
import { RecompraView } from "./recompra-view";

export const dynamic = "force-dynamic";

/**
 * RECOMPRA — a loja inteira por estágio de recompra, as VIPs (Top 20) e quem
 * cutucar hoje (aniversariantes + novidades do gosto de cada uma).
 * Vendedora vê a carteira dela; gerente/admin, a loja inteira.
 */
export default async function RecompraPage() {
  const user = await requireUser();
  if (user.role === "SUPPORT") redirect("/dashboard");
  const dados = await dadosDaAbaRecompra(user);
  return <RecompraView dados={dados} />;
}
