import Link from "next/link";
import type { AvisoContaPadrao as Aviso } from "@/lib/financeiro/visao";

/**
 * O AVISO DA CONTA PADRÃO (RN-033).
 *
 * Sem uma conta escolhida, a porta única de entrada das vendas registra o
 * recebimento mas NÃO dá a baixa — e a lojista vê, no card "Atrasado", a
 * mesma venda que ela acabou de marcar como paga em Pedidos. O motivo estava
 * escrito só no histórico do lançamento, onde ninguém olha. Agora está em
 * vermelho, nas duas telas onde ela repara na falta: o painel e Contas a
 * Receber. Trava que não explica vira "o sistema não funciona".
 */
export function AvisoContaPadrao({ aviso }: { aviso: Aviso }) {
  if (!aviso.semConta && !aviso.semPadrao) return null;
  const n = aviso.vendasParadas;
  const muitas = n > 1;
  return (
    <div className="mb-5 rounded-2xl border border-rose-300 bg-rose-50 p-4">
      <p className="text-sm font-semibold text-rose-900">
        {aviso.semConta
          ? "Falta cadastrar a conta onde o dinheiro da loja entra"
          : "Falta escolher a conta onde o dinheiro das vendas entra"}
      </p>
      <p className="mt-1 text-sm text-rose-800">
        {n > 0 ? (
          <>
            <b>
              {n} {muitas ? "vendas pagas" : "venda paga"}
            </b>{" "}
            {muitas ? "estão" : "está"} esperando: sem saber em qual conta o
            dinheiro caiu, o sistema não dá a baixa sozinho e{" "}
            {muitas ? "elas aparecem" : "ela aparece"} como{" "}
            {muitas ? "atrasadas" : "atrasada"}.
          </>
        ) : (
          <>
            Enquanto não houver conta padrão, o pedido que você marcar como pago
            vai continuar aparecendo aqui como a receber.
          </>
        )}{" "}
        Assim que você escolher, o sistema acerta as vendas que ficaram para trás.
      </p>
      <Link
        href="/financeiro/cadastros"
        className="mt-3 inline-flex items-center rounded-xl bg-rose-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-rose-700"
      >
        {aviso.semConta ? "Cadastrar a conta" : "Escolher a conta padrão"}
      </Link>
    </div>
  );
}
