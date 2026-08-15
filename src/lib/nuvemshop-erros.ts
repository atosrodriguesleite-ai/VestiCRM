/**
 * O QUE DEU ERRADO NA NUVEMSHOP — em português, com o que fazer.
 *
 * A tela dizia só "Não foi possível sincronizar." e parava por aí: a lojista
 * não sabia se era senha vencida, se a Nuvemshop estava fora do ar, se era
 * culpa dela ou nossa — e a gente também não, porque nada ficava registrado.
 *
 * Cada motivo aqui vira uma frase que responde as duas perguntas que
 * importam: POR QUE parou e O QUE EU FAÇO agora.
 */

export type MotivoNuvemshop =
  | "SEM_CONEXAO" // a loja não está conectada (ou foi desconectada)
  | "CREDENCIAL_ILEGIVEL" // o token salvo não pôde ser aberto
  | "AUTORIZACAO" // 401/403 — a Nuvemshop recusou a autorização
  | "LIMITE" // 429 — bateu no limite de chamadas
  | "FORA_DO_AR" // 5xx — problema do lado da Nuvemshop
  | "SEM_RESPOSTA" // rede/timeout
  | "DESCONHECIDO";

export type ExplicacaoNuvemshop = { motivo: MotivoNuvemshop; mensagem: string };

/** Traduz o código HTTP que a Nuvemshop devolveu. */
export function motivoPeloStatus(status: number): MotivoNuvemshop {
  if (status === 401 || status === 403) return "AUTORIZACAO";
  if (status === 429) return "LIMITE";
  if (status >= 500) return "FORA_DO_AR";
  if (status === 0) return "SEM_RESPOSTA";
  return "DESCONHECIDO";
}

const MENSAGENS: Record<MotivoNuvemshop, string> = {
  SEM_CONEXAO:
    "A loja não está conectada à Nuvemshop. Clique em Conectar e autorize o aplicativo.",
  CREDENCIAL_ILEGIVEL:
    "A autorização salva não pôde ser lida por este servidor. Clique em Desconectar e conecte a loja de novo — leva 1 minuto e nada do que já foi importado é perdido.",
  AUTORIZACAO:
    "A Nuvemshop recusou a autorização (o acesso do aplicativo foi revogado ou venceu). Clique em Desconectar e conecte a loja de novo.",
  LIMITE:
    "A Nuvemshop pediu para esperar: muitas consultas em pouco tempo. Tente de novo em alguns minutos — nada foi perdido.",
  FORA_DO_AR:
    "A Nuvemshop está com instabilidade no momento. Tente de novo em alguns minutos.",
  SEM_RESPOSTA:
    "Não houve resposta da Nuvemshop (conexão caiu ou demorou demais). Tente de novo; se a loja tem muitos produtos, a sincronização pode passar do tempo limite.",
  DESCONHECIDO:
    "A Nuvemshop respondeu de um jeito que o sistema não entendeu. Tente de novo e, se repetir, avise o suporte.",
};

export function explicarNuvemshop(motivo: MotivoNuvemshop): ExplicacaoNuvemshop {
  return { motivo, mensagem: MENSAGENS[motivo] };
}

/**
 * Motivo a partir de uma exceção. O caso mais traiçoeiro é o do token salvo
 * criptografado: se a chave de segurança do servidor mudou, abrir o token
 * estoura — e o erro cru ("Unsupported state or unable to authenticate data")
 * não diz nada para ninguém.
 */
export function motivoPeloErro(e: unknown): MotivoNuvemshop {
  const texto = e instanceof Error ? `${e.message}` : String(e ?? "");
  if (/unable to authenticate data|unsupported state|bad decrypt|wrong final block/i.test(texto))
    return "CREDENCIAL_ILEGIVEL";
  if (/timeout|aborted|fetch failed|network|ENOTFOUND|ECONN/i.test(texto)) return "SEM_RESPOSTA";
  return "DESCONHECIDO";
}
