"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * ATUALIZAÇÃO AUTOMÁTICA DO PEDIDO enquanto a loja espera o pagamento.
 *
 * Pix/cartão (InfinitePay, Mercado Pago) confirmam pelo webhook e o pedido
 * vira PAGO no servidor — mas a tela ABERTA não sabia disso até alguém dar
 * refresh na mão. Aqui a tela pergunta o status a cada poucos segundos e, se
 * ele mudou, recarrega os dados sozinha (a faixa vira "Pago", o painel de
 * cobrança some etc.).
 *
 * Só observa enquanto o pedido AINDA pode virar pago sozinho (orçamento /
 * aguardando pagamento). Assim que sai desse estado, para de perguntar — não
 * fica batendo no servidor à toa. Aba em segundo plano também não pergunta.
 */
export function StatusLive({
  orderId,
  statusInicial,
}: {
  orderId: string;
  statusInicial: string;
}) {
  const router = useRouter();
  const atual = useRef(statusInicial);

  useEffect(() => {
    // pedido que já saiu de "esperando pagamento" não muda sozinho: não observa
    const AGUARDANDO = statusInicial === "ORCAMENTO" || statusInicial === "AGUARDANDO_PAGAMENTO";
    if (!AGUARDANDO) return;
    atual.current = statusInicial;

    let vivo = true;
    async function checar() {
      if (!vivo || document.visibilityState !== "visible") return;
      try {
        const r = await fetch(`/api/orders/${orderId}/status`, { cache: "no-store" });
        if (!r.ok || !vivo) return;
        const d = (await r.json()) as { status?: string };
        if (d.status && d.status !== atual.current) {
          atual.current = d.status;
          // recarrega os dados do servidor: a tela reflete o novo status.
          // Quando o status vira terminal, o próximo render entra com o novo
          // `statusInicial` e este efeito para de observar.
          router.refresh();
        }
      } catch {
        // rede oscilou — tenta de novo no próximo tique
      }
    }

    const timer = setInterval(checar, 4000);
    // checa na hora ao voltar o foco (a loja abriu a InfinitePay e voltou)
    const onVisible = () => {
      if (document.visibilityState === "visible") void checar();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checar);
    return () => {
      vivo = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checar);
    };
  }, [orderId, statusInicial, router]);

  return null;
}
