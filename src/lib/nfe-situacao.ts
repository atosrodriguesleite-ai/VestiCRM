import { PAID_ORDER_STATUSES } from "./orders";

/**
 * QUANDO O PEDIDO PODE GANHAR UMA NOTA NOVA.
 *
 * Relato do dono (16/09/2026): a nota saiu REJEITADA, ele corrigiu o cadastro
 * da cliente (faltava a inscrição estadual) e **não achou como reemitir**. Não
 * era falta de permissão: o servidor já aceitava (`emitirNfeDoPedido` deixa
 * passar `REJEITADA` e `CANCELADA`, e a própria mensagem de erro dele diz
 * *"clique em emitir de novo para gerar uma nota nova"*) — o botão é que não
 * existia na tela, porque ela mostrava o selo da nota OU o botão, nunca os
 * dois. Beco sem saída: a ficha anunciava o problema e escondia o conserto.
 *
 * A régua, que é a mesma do fisco:
 *
 *  • **AUTORIZADA nunca** — a nota existe, vale, e emitir outra é nota em
 *    dobro (mesma decisão da RN-038 no Financeiro). Errada, se cancela.
 *  • **REJEITADA e CANCELADA sempre** — perante o fisco elas não existem, e o
 *    pedido PRECISA de uma nota. É o caso que originou esta regra.
 *  • **ERRO** — deu problema no meio do caminho: o caminho existe e é a
 *    RETOMADA, que consulta o Bling antes de criar qualquer coisa (o caso
 *    traiçoeiro é o tempo esgotar DEPOIS de a SEFAZ aceitar). **Ela NÃO
 *    remonta a nota**: retransmite o rascunho que já está lá. Por isso o
 *    `remontaNota` abaixo — a ficha não pode prometer a natureza/NCM novos
 *    num caminho que manda os antigos (achado da revisão). Quem corrigiu o
 *    cadastro chega aos dados novos assim: retomar descobre que a anterior
 *    está recusada, o pedido volta a REJEITADA, e AÍ a nota nova é montada
 *    do zero.
 *  • **EMITINDO** não — está em andamento; aí o que resolve é "atualizar".
 */

export type AcaoDaNota =
  | { pode: false; motivo: string }
  | {
      pode: true;
      rotulo: string;
      aviso: string;
      confirmacao: string;
      /**
       * A nota é MONTADA DE NOVO (natureza, NCM e valores relidos do cadastro)?
       * Só quando isso é verdade a ficha pode dizer o que a nota vai levar.
       */
      remontaNota: boolean;
    };

export function acaoDaNota(status: string | null | undefined): AcaoDaNota {
  if (!status) {
    return {
      pode: true,
      rotulo: "Emitir NF-e (Bling)",
      aviso: "",
      confirmacao:
        "Emitir a NF-e deste pedido via Bling? A nota vai para a Receita — confira antes os itens e o CPF/CNPJ do cliente.",
      remontaNota: true,
    };
  }
  if (status === "AUTORIZADA") {
    return {
      pode: false,
      motivo:
        "Esta nota está autorizada e vale perante a Receita. Emitir outra criaria nota em dobro — se ela estiver errada, cancele no Bling (o prazo é curto) e o botão de emitir volta.",
    };
  }
  if (status === "REJEITADA" || status === "CANCELADA") {
    const rejeitada = status === "REJEITADA";
    return {
      pode: true,
      rotulo: "Emitir nova NF-e",
      aviso: rejeitada
        ? "A SEFAZ recusou esta nota, então ela não existe perante o fisco. Corrija o que ela apontou (no cadastro da cliente ou nos dados fiscais) e emita de novo — o pedido continua sem nota."
        : "Esta nota foi cancelada, então o pedido está sem nota. Dá para emitir uma nova.",
      confirmacao:
        "Emitir uma NOVA NF-e para este pedido? A nota anterior não vale (foi recusada ou cancelada), então esta não fica em dobro.",
      // nota nova é montada do zero: pega o cadastro da cliente como ele
      // está AGORA, que é o que faz corrigir a ficha ter efeito
      remontaNota: true,
    };
  }
  if (status === "ERRO") {
    return {
      pode: true,
      rotulo: "Tentar de novo",
      aviso:
        "Algo falhou no meio da emissão. O sistema consulta o Bling para ver o que aconteceu com a nota anterior — assim uma falha de conexão depois de a SEFAZ aceitar não vira nota duplicada. Atenção: este passo REENVIA a nota que já estava montada, com os dados de quando ela foi criada. Se você corrigiu o cadastro da cliente agora, toque aqui primeiro: descobrindo que a anterior foi recusada, o pedido libera a emissão de uma nota NOVA, aí sim com os dados atualizados.",
      confirmacao:
        "Tentar a emissão de novo? O sistema confere primeiro o que aconteceu com a nota anterior. Este passo reenvia a nota já montada — ele não incorpora correções feitas no cadastro depois dela.",
      // NÃO remonta: `retomarNfeComErro` faz POST /nfe/{id}/enviar no mesmo
      // rascunho. Prometer a natureza nova aqui seria mentira (achado da
      // revisão) — e mentira sobre documento fiscal.
      remontaNota: false,
    };
  }
  // EMITINDO e qualquer situação nova do Bling que ainda não conhecemos:
  // não oferecer o botão é o lado seguro, porque o estrago aqui é nota em
  // dobro — e "atualizar" continua disponível para saber como ficou
  return {
    pode: false,
    motivo:
      "A emissão está em andamento. Toque em “atualizar” para ver como ficou; o botão de emitir volta se ela for recusada.",
  };
}

/**
 * O SELO DA NOTA NA LISTA DE PEDIDOS.
 *
 * Pedido do dono (16/09/2026): *"queria uma visualização na aba de pedidos,
 * dos que estão com nota fiscal — uma caixa no canto que diz NF e o número"*.
 *
 * Duas decisões além do pedido:
 *
 *  • **A nota que DEU ERRADO também aparece, e em vermelho.** O número da
 *    nota autorizada é conferência; a nota recusada é PROBLEMA — pedido pago
 *    sem nota é pendência fiscal, e hoje ela só aparece abrindo o pedido um
 *    por um. É o selo que faz a lojista ver, e é onde ele vale mais.
 *  • **Pedido sem nota não ganha selo nenhum.** Marcar ausência em 98 linhas
 *    polui a lista inteira para não dizer nada — quem procura "ainda não
 *    emiti" olha o que NÃO tem selo.
 *
 * A nota em andamento aparece como relógio: some sozinha quando resolver, e
 * enquanto isso explica por que o botão de emitir não está lá.
 */
export type SeloDaNota = { texto: string; cor: string; titulo: string };

export function seloDaNota(
  status: string | null | undefined,
  numero: string | null | undefined
): SeloDaNota | null {
  if (!status) return null;
  if (status === "AUTORIZADA") {
    return {
      texto: numero ? `NF ${numero}` : "NF emitida",
      cor: "#059669",
      titulo: "Nota fiscal autorizada",
    };
  }
  if (status === "REJEITADA") {
    return {
      texto: "NF recusada",
      cor: "#E11D48",
      titulo: "A SEFAZ recusou a nota — o pedido está sem nota. Abra para corrigir e emitir de novo.",
    };
  }
  if (status === "CANCELADA") {
    return {
      texto: "NF cancelada",
      cor: "#E11D48",
      titulo: "A nota foi cancelada — o pedido está sem nota.",
    };
  }
  if (status === "ERRO") {
    return {
      texto: "NF com erro",
      cor: "#E11D48",
      titulo: "A emissão falhou. Abra o pedido para tentar de novo.",
    };
  }
  return { texto: "NF ⏳", cor: "#D97706", titulo: "Emissão em andamento" };
}

/**
 * O PEDIDO QUE ESTÁ ESPERANDO NOTA.
 *
 * Pedido do dono (16/09/2026), depois do selo: um filtro no topo da lista que
 * junta "o que falta emitir", para a loja virar a fila de uma vez em vez de
 * caçar linha sem selo.
 *
 * A definição tem duas metades, e as duas importam:
 *
 *  • **PAGO** (RN-001). Orçamento e aguardando pagamento não estão esperando
 *    nota — a própria emissão os recusa ("emita só depois que estiver pago"),
 *    e cancelado não precisa de nota. Sem esse recorte o filtro devolveria a
 *    loja inteira e não seria fila de nada.
 *  • **Sem nota AUTORIZADA.** Nunca emitida, recusada, cancelada ou com erro
 *    são todas o mesmo fato para a loja: o pedido está pago e sem documento.
 *    **EMITINDO fica DENTRO** de propósito — o selo já mostra ⏳ e a pessoa vê
 *    que está a caminho; tirá-la sumiria com a emissão que travou, e um pedido
 *    pago sem nota escondido é pior que uma linha a mais na fila.
 */
export function precisaDeNota(
  statusDoPedido: string,
  nfeStatus: string | null | undefined,
  statusPagos: readonly string[]
): boolean {
  if (!statusPagos.includes(statusDoPedido)) return false;
  return nfeStatus !== "AUTORIZADA";
}

/**
 * A MESMA REGRA, do jeito que o banco entende — e ela mora AQUI, colada na
 * função de cima, de propósito: são duas escritas da mesma coisa, e separadas
 * em arquivos diferentes uma mudaria sem a outra (achado da revisão). Quem
 * mexer numa vê a outra na linha seguinte, e
 * `scripts/confere-fila-nota.ts` prova contra o Postgres que as duas
 * concordam nas 48 combinações.
 *
 * **O `OR` não é estilo, é o que faz o filtro funcionar**: em SQL,
 * `nfeStatus != 'AUTORIZADA'` **não devolve quem está NULO** — e nulo é o
 * pedido que nunca emitiu, a maioria da fila. Sem ele, medido no banco local,
 * a fila de 25 mostrava 20 e escondia justamente os 5 que ninguém emitiu.
 */
export const ONDE_FALTA_NOTA = {
  status: { in: [...PAID_ORDER_STATUSES] },
  OR: [{ nfeStatus: null }, { nfeStatus: { not: "AUTORIZADA" } }],
} satisfies { status: unknown; OR: unknown[] };
