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
 * DOIS RITMOS, conforme o que pode acontecer:
 *  • esperando pagamento (orçamento / aguardando) → pergunta a cada 4s: o
 *    dinheiro cai em segundos e a tela tem que virar "Pago" na hora;
 *  • pedido pago que ainda pode andar pelo rastreio (postado → Enviado,
 *    chegou → Entregue) → NÃO fica perguntando (isso leva horas), mas
 *    reconfere AO VOLTAR o foco. A vendedora sai do app, entrega a cliente,
 *    volta — e a tela está certa, em vez de mostrar "Pago" o dia inteiro.
 *  • pedido entregue ou cancelado → não observa nada.
 * Aba em segundo plano nunca pergunta.
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
    const AGUARDANDO = statusInicial === "ORCAMENTO" || statusInicial === "AGUARDANDO_PAGAMENTO";
    // pago e ainda a caminho: o rastreio pode fazer o pedido andar sozinho
    const PODE_ANDAR =
      statusInicial === "PAGO" ||
      statusInicial === "EM_PRODUCAO" ||
      statusInicial === "SEPARACAO" ||
      statusInicial === "ENVIADO";
    if (!AGUARDANDO && !PODE_ANDAR) return;
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

    // 4s só para quem espera dinheiro; entrega leva horas e não merece poller
    const timer = AGUARDANDO ? setInterval(checar, 4000) : null;
    // checa na hora ao voltar o foco (a loja abriu a InfinitePay e voltou)
    const onVisible = () => {
      if (document.visibilityState === "visible") void checar();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", checar);
    return () => {
      vivo = false;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", checar);
    };
  }, [orderId, statusInicial, router]);

  return null;
}
