/**
 * TRADUÇÃO DOS EVENTOS DE COMUNICAÇÃO.
 *
 * A Central de Comunicação é a tela que a LOJISTA abre quando desconfia que
 * "o WhatsApp está estranho". Até aqui ela mostrava `message.sent`,
 * `status.update` e um JSON cru — informação de programador, inútil para
 * quem precisa decidir o que fazer.
 *
 * Duas regras guiam este arquivo:
 *
 *  1. DIZER ONDE ERROU. Não basta "falhou": tem que dizer em que etapa,
 *     com qual cliente e por quê.
 *  2. QUANDO DIZ ERRO, É ERRO. Bolinha vermelha em coisa normal treina a
 *     pessoa a ignorar o painel — e aí o erro de verdade passa batido.
 */

export type Gravidade = "OK" | "ATENCAO" | "ERRO";

export type LeituraEvento = {
  /** o que aconteceu, em português */
  titulo: string;
  /** em que etapa quebrou (só quando é falha) */
  ondeErrou?: string;
  /** a causa, explicada */
  porque?: string;
  /** o que a loja deve fazer */
  oQueFazer?: string;
  gravidade: Gravidade;
};

const TITULOS: Record<string, string> = {
  "message.received": "Mensagem recebida da cliente",
  "message.sent": "Mensagem enviada pelo sistema",
  "message.resent": "Mensagem reenviada",
  "status.update": "Confirmação de entrega/leitura",
  "wa.cliente.apagou": "A cliente apagou uma mensagem",
  "wa.historico.leitura": "Leitura do histórico do WhatsApp",
  "webhook.error": "Aviso do WhatsApp recusado pelo sistema",
  // registros antigos, de diagnósticos que já cumpriram o papel
  "wa.anuncio.ausente": "Registro antigo (diagnóstico de anúncio)",
};

/**
 * Nome apresentável para um tipo que ainda não tem tradução. Vale mais
 * "Mensagem sent" do que `message.sent` na cara da lojista, e o dia que
 * aparecer um tipo novo a tela não fica com jeito de erro.
 */
function tituloGenerico(tipo: string): string {
  const limpo = tipo.replace(/[._]/g, " ").trim();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

/**
 * Causas conhecidas de falha no envio. A ordem importa: a primeira que casar
 * vence, então as mensagens mais específicas vêm antes.
 */
const CAUSAS: {
  casa: (erro: string) => boolean;
  porque: string;
  oQueFazer: string;
}[] = [
  {
    casa: (e) => /não conectado|conecte o número|QR Code/i.test(e),
    porque: "O WhatsApp da loja não está conectado ao sistema.",
    oQueFazer:
      "Nesta mesma tela, clique em Conectar WhatsApp e leia o QR Code com o celular da loja.",
  },
  {
    casa: (e) => /servidor de conexão.*fora do ar|fora do ar/i.test(e),
    porque: "O servidor que liga o sistema ao WhatsApp ficou fora do ar por alguns instantes.",
    oQueFazer:
      "Costuma voltar sozinho. Se as mensagens seguirem falhando por mais de 15 minutos, avise o suporte.",
  },
  {
    casa: (e) => /não conseguiu entregar/i.test(e),
    porque:
      "O WhatsApp aceitou o envio mas não conseguiu entregar — em geral número errado, sem WhatsApp, ou quem bloqueou a loja.",
    oQueFazer: "Confira o número da cliente no cadastro e tente por outro contato.",
  },
  {
    casa: (e) => /HTTP 4\d\d/i.test(e),
    porque: "O WhatsApp recusou esta mensagem (formato do número ou do arquivo).",
    oQueFazer:
      "Confira o número da cliente. Se era foto ou arquivo, tente com um menor ou em outro formato.",
  },
  {
    casa: (e) => /HTTP 5\d\d/i.test(e),
    porque: "O servidor de WhatsApp respondeu com erro interno.",
    oQueFazer: "Tente reenviar em alguns minutos. Se insistir, avise o suporte.",
  },
  {
    casa: (e) => /Meta recusou|Meta não devolveu|falar com a Meta/i.test(e),
    porque: "A Meta (WhatsApp oficial) recusou o envio.",
    oQueFazer: "Confira as credenciais da API oficial em Configurações.",
  },
  {
    casa: (e) => /timeout|abort|network|fetch/i.test(e),
    porque: "A conexão com o servidor de WhatsApp demorou demais e foi interrompida.",
    oQueFazer:
      "Verifique se a mensagem chegou no WhatsApp antes de reenviar — às vezes ela sai mesmo com o erro na tela.",
  },
];

/** Onde, no caminho da mensagem, cada evento quebra. */
const ONDE: Record<string, string> = {
  "message.sent": "Ao enviar a mensagem para a cliente",
  "message.resent": "Ao reenviar a mensagem",
  "message.received": "Ao receber a mensagem da cliente",
  "status.update": "Ao registrar a confirmação de entrega",
  "wa.historico.leitura": "Ao importar o histórico do WhatsApp",
};

export function lerEvento(evento: {
  type: string;
  status: string;
  error?: string | null;
  payload?: string | null;
}): LeituraEvento {
  const titulo = TITULOS[evento.type] ?? tituloGenerico(evento.type);

  if (evento.status !== "ERRO") {
    return { titulo, gravidade: "OK" };
  }

  const erro = evento.error ?? "";
  const causa = CAUSAS.find((c) => c.casa(erro));

  // destinatário, quando o evento guardou (ajuda a achar a conversa)
  let paraQuem = "";
  try {
    const p = evento.payload ? JSON.parse(evento.payload) : null;
    if (p?.to) paraQuem = ` (número ${String(p.to)})`;
  } catch {
    /* payload ilegível não pode derrubar a leitura */
  }

  return {
    titulo,
    ondeErrou: `${ONDE[evento.type] ?? "Durante a comunicação"}${paraQuem}`,
    porque: causa?.porque ?? (erro ? `Motivo informado: ${erro}` : "Causa não identificada."),
    oQueFazer:
      causa?.oQueFazer ??
      "Tente reenviar. Se o erro repetir, mande esta tela para o suporte.",
    gravidade: "ERRO",
  };
}

/**
 * Resumo honesto das últimas 24h. É a frase que responde "está tudo bem?"
 * sem obrigar a lojista a interpretar log nenhum.
 */
export function resumoDoPeriodo(input: {
  recebidas: number;
  enviadas: number;
  falhas: number;
  naFila: number;
}): { gravidade: Gravidade; titulo: string; detalhe: string } {
  if (input.falhas > 0) {
    return {
      gravidade: "ERRO",
      titulo:
        input.falhas === 1
          ? "1 mensagem não foi entregue nas últimas 24h"
          : `${input.falhas} mensagens não foram entregues nas últimas 24h`,
      detalhe: "Veja abaixo, no filtro Erros, o que aconteceu em cada uma e o que fazer.",
    };
  }
  if (input.naFila > 0) {
    return {
      gravidade: "ATENCAO",
      titulo: `${input.naFila} mensagem(ns) ainda saindo`,
      detalhe: "Se ficarem paradas por mais de alguns minutos, avise o suporte.",
    };
  }
  if (input.recebidas === 0 && input.enviadas === 0) {
    return {
      gravidade: "ATENCAO",
      titulo: "Nenhuma mensagem nas últimas 24h",
      detalhe:
        "Pode ser um dia parado — mas se a loja conversou pelo celular e nada apareceu aqui, avise o suporte.",
    };
  }
  return {
    gravidade: "OK",
    titulo: "Nenhuma falha nas últimas 24h",
    detalhe: `${input.recebidas} recebida(s) e ${input.enviadas} enviada(s) sem erro.`,
  };
}
