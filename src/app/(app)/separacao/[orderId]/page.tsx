import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader, Alert } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { estadoDaSeparacao } from "@/lib/etiquetas/separacao";
import { SepararView } from "./separar-view";

export const dynamic = "force-dynamic";

/**
 * A TELA DO BIPE (RN-060): lê o estado da separação do pedido (a ativa
 * nasce no primeiro bipe) e entrega as peças com o código de cada uma. A trava do módulo está no layout da
 * área; a visibilidade do pedido (RN-007) está no `abrirSeparacao`.
 */
export default async function SepararPedidoPage({ params }: { params: Promise<{ orderId: string }> }) {
  const user = await requireUser();
  const { orderId } = await params;
  const estado = await estadoDaSeparacao(user, orderId);
  if ("erro" in estado) {
    return (
      <div>
        <PageHeader title="Separar pedido" />
        <Alert tone="warning">{estado.erro}</Alert>
        <Link href="/separacao" className="inline-flex items-center gap-1 text-sm text-brand-700 mt-4 hover:underline">
          <ArrowLeft className="size-4" /> Voltar para a fila
        </Link>
      </div>
    );
  }
  return (
    <SepararView
      inicial={{
        ...estado,
        quem: estado.quem ? { ...estado.quem, desde: estado.quem.desde.toISOString() } : null,
        jaSeparadoEm: estado.jaSeparadoEm?.toISOString() ?? null,
      }}
      meuId={user.id}
    />
  );
}
