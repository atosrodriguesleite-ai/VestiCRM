import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { db } from "@/lib/db";
import { orderNumber } from "@/lib/orders";
import { RomaneioViewer } from "./viewer";

/**
 * Visualizador do romaneio DENTRO do app.
 *
 * Por que existe: no celular com o AtacadoPro instalado (PWA em tela cheia),
 * abrir o link direto do PDF navegava a própria janela do app para o
 * visualizador nativo — que não tem botão de voltar nem de fechar. A lojista
 * ficava presa e precisava matar o app para sair (relato da Toque Leve,
 * 18/08/2026). Aqui o PDF é desenhado numa página normal do sistema, com
 * "Voltar" sempre à mão, além de compartilhar/baixar.
 */

export const dynamic = "force-dynamic";

export default async function RomaneioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  // mesma régua de visibilidade da rota do PDF (RN-007)
  const order = await db.order.findFirst({
    where: { id, ...orderScope(user) },
    select: { id: true, number: true },
  });
  if (!order) notFound();

  return <RomaneioViewer orderId={order.id} numero={orderNumber(order.number)} />;
}
