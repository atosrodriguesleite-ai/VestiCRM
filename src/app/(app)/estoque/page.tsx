import { PageHeader } from "@/components/ui";
import { InventarioView } from "./inventario-view";

export const dynamic = "force-dynamic";

/**
 * Tela ESTOQUE · Inventário (RN-050): uma linha por cor e tamanho, com o
 * que está na loja, o que já está reservado em pedido e o que sobra para
 * vender — e o ajuste rápido na própria linha, com motivo. Peça controlada
 * pela Nuvemshop/Jueri só se lê aqui. A trava do módulo está no layout.
 */
export default function EstoquePage() {
  return (
    <div>
      <PageHeader
        title="Estoque"
        subtitle="Cada cor e tamanho com o que está na loja, o que já está reservado em pedido e o que sobra para vender. Ajuste na própria linha — sempre com motivo."
      />
      <InventarioView />
    </div>
  );
}
