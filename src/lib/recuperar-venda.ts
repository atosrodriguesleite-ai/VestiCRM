/**
 * RECUPERAR A VENDA PERDIDA (pedido do dono, 07/10/2026): na lista de
 * pedidos, o pedido CANCELADO ganha dois botões — "Restaurar como orçamento"
 * (volta a segurar o estoque como pedido novo, pela porta de sempre; cancelar
 * de novo volta a perguntar se devolve ou baixa) e "Recuperar venda", que
 * abre a conversa da cliente na Central com esta mensagem já no campo. A
 * vendedora revisa e manda — o sistema nunca envia sozinho (RN-017).
 */

export function mensagemDeRecuperacao(pedido: {
  nomeDaCliente: string;
  numero: string;
  totalDePecas: number;
  /** nomes das peças que a lista já carrega (as primeiras bastam) */
  pecas: string[];
}): string {
  const primeiroNome = pedido.nomeDaCliente.trim().split(/\s+/)[0] || "tudo bem";
  // nomes repetidos ("Regata Alça, Regata Alça, Regata Alça") viram um só
  const modelos = [...new Set(pedido.pecas.map((p) => p.trim()).filter(Boolean))].slice(0, 3);
  const pecasTexto =
    pedido.totalDePecas > 0
      ? ` (${pedido.totalDePecas} ${pedido.totalDePecas === 1 ? "peça" : "peças"}${
          modelos.length ? ` — ${modelos.join(", ")}` : ""
        })`
      : "";
  return (
    `Oi, ${primeiroNome}! Tudo bem? 😊 Vi aqui que o seu pedido ${pedido.numero}${pecasTexto} acabou não indo para frente. ` +
    `Ainda tem interesse? Posso conferir o que temos disponível e te ajudar a fechar. 💛`
  );
}
