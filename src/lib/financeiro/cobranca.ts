import { db } from "../db";
import { sendMessage } from "../comm/engine";
import { brl } from "../format";
import { diaSP } from "./lancamentos";

/**
 * COBRANÇA PELO WHATSAPP (RN-032) — o que só o AtacadoPro consegue fazer.
 *
 * Um financeiro comum mostra a lista de inadimplentes e para por aí; a
 * lojista ainda tem que sair procurando a conversa uma por uma. Aqui a
 * cobrança sai pela MESMA Central de Atendimento que ela já usa: a mensagem
 * entra na conversa da cliente, com o ritmo anti-ban da RN-017, aparece para
 * a vendedora e fica no histórico — é conversa, não é robô.
 *
 * Três cuidados de quem conhece a casa:
 *  • a mensagem é MONTADA pelo sistema mas ENVIADA por uma pessoa clicando —
 *    disparo automático para cliente é decisão da loja, não nossa;
 *  • a mesma parcela não é cobrada duas vezes no mesmo dia (a tela mostra
 *    "cobrada hoje" e o botão sai do caminho);
 *  • sem WhatsApp conectado, a porta recusa com uma frase que explica —
 *    dizer "cobrança enviada" sem ter enviado seria pior que não ter o botão.
 */

export type DadosDaCobranca = {
  clienteNome: string;
  descricao: string;
  valor: number;
  vencimento: Date;
  diasDeAtraso: number;
};

/**
 * O texto da cobrança. Regra pura: nunca constrange e nunca acusa — a maior
 * parte dos atrasos é esquecimento, e a cliente continua sendo cliente.
 */
export function montarMensagemDeCobranca(d: DadosDaCobranca): string {
  const primeiroNome = d.clienteNome.trim().split(/\s+/)[0] || "Oi";
  const venc = diaSP(d.vencimento).split("-").reverse().join("/");
  const abertura =
    d.diasDeAtraso <= 0
      ? `Oi, ${primeiroNome}! Passando para lembrar do vencimento de hoje 🙂`
      : d.diasDeAtraso <= 3
        ? `Oi, ${primeiroNome}! Tudo bem? Passando para lembrar de um valor que venceu há pouquinho 🙂`
        : `Oi, ${primeiroNome}! Tudo bem? Estou passando para lembrar de um valor em aberto por aqui 🙂`;
  return [
    abertura,
    "",
    `📄 ${d.descricao}`,
    `💰 ${brl(d.valor)}`,
    d.diasDeAtraso > 0
      ? `📅 Venceu em ${venc} (${d.diasDeAtraso} dia${d.diasDeAtraso > 1 ? "s" : ""})`
      : `📅 Vence hoje (${venc})`,
    "",
    "Se já tiver pago, me avisa que eu dou baixa aqui! Qualquer coisa a gente combina do seu jeito 💛",
  ].join("\n");
}

export type ResultadoCobranca =
  | { ok: true; conversationId: string }
  | { ok: false; erro: string; status: number };

/**
 * Manda a cobrança da parcela pela Central. Devolve o motivo em português
 * quando não dá — a tela repete a frase para a lojista.
 */
export async function cobrarParcelaNoWhatsapp(
  companyId: string,
  parcelaId: string,
  autor: { id: string; name: string },
  hoje = new Date()
): Promise<ResultadoCobranca> {
  const parcela = await db.finParcela.findFirst({
    where: { companyId, id: parcelaId },
    include: {
      baixas: true,
      lancamento: {
        select: {
          id: true,
          tipo: true,
          descricao: true,
          canceladoEm: true,
          cobradoEm: true,
          customer: { select: { id: true, name: true, phone: true, blockedAt: true } },
        },
      },
    },
  });
  if (!parcela) return { ok: false, erro: "Parcela não encontrada", status: 404 };
  const l = parcela.lancamento;
  if (l.tipo !== "RECEITA")
    return { ok: false, erro: "Só dá para cobrar conta a receber", status: 400 };
  if (l.canceladoEm)
    return { ok: false, erro: "Este lançamento está cancelado", status: 409 };
  if (!l.customer)
    return {
      ok: false,
      erro: "Este lançamento não tem cliente — abra a ficha e escolha quem deve",
      status: 409,
    };
  if (!l.customer.phone)
    return { ok: false, erro: "A cliente não tem WhatsApp no cadastro", status: 409 };
  if (l.customer.blockedAt)
    return { ok: false, erro: "Esta cliente está bloqueada no WhatsApp", status: 409 };

  const abatido = parcela.baixas
    .filter((b) => !b.estornadaEm)
    .reduce((s, b) => s + b.valor, 0);
  const falta = Math.round((parcela.valor - abatido) * 100) / 100;
  if (falta <= 0)
    return { ok: false, erro: "Esta parcela já está quitada", status: 409 };

  // não cobra duas vezes no mesmo dia — a cliente não merece isso, e a
  // conta da loja no WhatsApp também não (RN-017).
  //
  // A vaga do dia é TOMADA ANTES de enviar, num update condicional: o envio
  // proativo espera de 4 a 9 segundos (ritmo anti-ban), e nessa janela dois
  // cliques passariam os dois pela conferência e a cliente receberia a
  // cobrança em dobro. Quem perder a corrida recebe a mesma frase.
  const inicioDoDia = new Date(`${diaSP(hoje)}T03:00:00.000Z`); // 00h em SP
  if (l.cobradoEm && diaSP(l.cobradoEm) === diaSP(hoje))
    return { ok: false, erro: "Esta conta já foi cobrada hoje", status: 409 };
  const vaga = await db.finLancamento.updateMany({
    where: {
      id: l.id,
      OR: [{ cobradoEm: null }, { cobradoEm: { lt: inicioDoDia } }],
    },
    data: { cobradoEm: hoje },
  });
  if (vaga.count === 0)
    return { ok: false, erro: "Esta conta já foi cobrada hoje", status: 409 };
  // devolve a marca de antes se o envio não sair (o `finally` do dinheiro:
  // conta que não foi cobrada não pode ficar marcada como cobrada)
  const desmarcar = () =>
    db.finLancamento
      .update({ where: { id: l.id }, data: { cobradoEm: l.cobradoEm } })
      .catch(() => {});

  const conversa = await garantirConversaDaCliente(
    companyId,
    l.customer.id,
    autor.id
  );
  const conversationId = conversa.id;

  const dias = Math.max(
    0,
    Math.round(
      (new Date(`${diaSP(hoje)}T12:00:00Z`).getTime() -
        new Date(`${diaSP(parcela.vencimento)}T12:00:00Z`).getTime()) /
        86_400_000
    )
  );

  const texto = montarMensagemDeCobranca({
    clienteNome: l.customer.name,
    descricao: l.descricao,
    valor: falta,
    vencimento: parcela.vencimento,
    diasDeAtraso: dias,
  });

  // O envio é SÍNCRONO de propósito: só depois de o WhatsApp aceitar é que a
  // conta pode ser marcada como cobrada. Dizer "cobrança enviada" sem ter
  // enviado é o pior resultado possível — a lojista risca da lista e a
  // cliente nunca soube de nada.
  let enviada;
  try {
    enviada = await sendMessage({
      conversationId,
      companyId,
      body: texto,
      kind: "TEXT",
      mediaType: "TEXT",
      authorId: autor.id,
      authorName: autor.name,
    });
  } catch (e) {
    console.error("[financeiro] cobrança não saiu", parcelaId, e);
    await desmarcar();
    await conversa.desfazer();
    return {
      ok: false,
      erro: "Não consegui enviar pelo WhatsApp — confira a conexão em Comunicação",
      status: 502,
    };
  }
  // A Central NÃO lança erro quando o provedor recusa: ela devolve a mensagem
  // marcada como FALHOU (é o que faz o ⏱️ virar ⚠️ na bolha do chat). Sem
  // olhar o status, a cobrança se dava por enviada com o WhatsApp desligado.
  if (enviada.status === "FALHOU") {
    console.error("[financeiro] cobrança não saiu", parcelaId, enviada.error);
    await desmarcar();
    await conversa.desfazer(enviada.id);
    return {
      ok: false,
      erro: "Não consegui enviar pelo WhatsApp — confira a conexão em Comunicação",
      status: 502,
    };
  }

  await db.finLancamentoEvento.create({
    data: {
      lancamentoId: l.id,
      descricao: `Cobrança enviada pelo WhatsApp (${brl(falta)}) por ${autor.name}`,
      autorNome: autor.name,
    },
  });

  return { ok: true, conversationId };
}

/**
 * Acha a conversa aberta da cliente, reabre a encerrada ou cria uma nova —
 * a mesma régua de "abrir conversa" que a Central usa quando a vendedora
 * clica no contato.
 *
 * Devolve junto o `desfazer`: cobrança que NÃO saiu não pode deixar rastro
 * na Central — conversa encerrada meses atrás reaberta e assumida, ou uma
 * conversa nova em branco, fazem a equipe atender uma cliente que nunca
 * recebeu nada.
 */
async function garantirConversaDaCliente(
  companyId: string,
  customerId: string,
  userId: string
): Promise<{ id: string; desfazer: (mensagemId?: string) => Promise<void> }> {
  const semDesfazer = async () => {};

  const aberta = await db.conversation.findFirst({
    where: { companyId, customerId, status: { not: "CLOSED" } },
    orderBy: { lastMessageAt: "desc" },
  });
  if (aberta) {
    // sem dona ainda? quem cobrou assume — ninguém fica esperando na fila
    if (!aberta.assigneeId) {
      await db.conversation.update({
        where: { id: aberta.id },
        data: { assigneeId: userId },
      });
      return {
        id: aberta.id,
        desfazer: async () => {
          await db.conversation
            .updateMany({
              where: { id: aberta.id, assigneeId: userId },
              data: { assigneeId: null },
            })
            .catch(() => {});
        },
      };
    }
    return { id: aberta.id, desfazer: semDesfazer };
  }

  const encerrada = await db.conversation.findFirst({
    where: { companyId, customerId, status: "CLOSED" },
    orderBy: { lastMessageAt: "desc" },
  });
  if (encerrada) {
    await db.conversation.update({
      where: { id: encerrada.id },
      data: { status: "OPEN", assigneeId: encerrada.assigneeId ?? userId },
    });
    return {
      id: encerrada.id,
      desfazer: async (mensagemId?: string) => {
        if (mensagemId)
          await db.message.delete({ where: { id: mensagemId } }).catch(() => {});
        await db.conversation
          .update({
            where: { id: encerrada.id },
            data: { status: "CLOSED", assigneeId: encerrada.assigneeId },
          })
          .catch(() => {});
      },
    };
  }

  const nova = await db.conversation.create({
    data: { companyId, customerId, channel: "WHATSAPP", status: "OPEN", assigneeId: userId },
  });
  return {
    id: nova.id,
    desfazer: async () => {
      // só some se continuar vazia: se a cliente respondeu nesse meio-tempo,
      // apagar a conversa levaria a mensagem dela junto
      const inbound = await db.message
        .count({ where: { conversationId: nova.id, direction: "IN" } })
        .catch(() => 1);
      if (inbound === 0)
        await db.conversation.delete({ where: { id: nova.id } }).catch(() => {});
    },
  };
}
