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
