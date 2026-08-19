import { PageHeader } from "@/components/ui";
import { EnviosView } from "./envios-view";

export const dynamic = "force-dynamic";

/**
 * Tela ENVIOS: tudo que a loja despachou pelo Melhor Envio num lugar só —
 * painel, lista com rastreio e o simulador de frete (RN-019). A trava
 * shippingEnabled está no layout.
 */
export default function EnviosPage() {
  return (
    <div>
      <PageHeader
        title="Envios"
        subtitle="Acompanhe cada caixa que saiu da loja: status, rastreio e quem recebe — e simule o frete antes de fechar o pedido."
      />
      <EnviosView />
    </div>
  );
}
