/**
 * MENSAGENS DA LISTA "QUEM CHAMAR HOJE" — personalizáveis por loja.
 *
 * Cada loja fala do seu jeito: a Toque Leve não escreve igual à Entre Linhas,
 * e uma mensagem que não parece da loja soa como robô — a cliente sente.
 * Por isso o texto vem de `CommSettings` e, quando a loja ainda não mexeu,
 * cai no padrão abaixo (que já é escrito na língua da vendedora de moda).
 *
 * Mesmo padrão das mensagens de catálogo e de pedido, que já eram editáveis.
 */

export type TipoChamada =
  | "ANIVERSARIO"
  | "RECOMPRA"
  | "POS_VENDA"
  | "NOVA"
  | "PARADA";

/** Variáveis que a loja pode usar no texto. */
export type VariaveisChamada = {
  /** primeiro nome da cliente */
  nome: string;
  /** dias desde a última compra (só faz sentido em recompra) */
  dias?: number;
};

export const MENSAGEM_PADRAO: Record<TipoChamada, string> = {
  ANIVERSARIO:
    "Oi {nome}! Passando para te desejar um feliz aniversário 🎉 Muitas felicidades! Preparei uma novidade especial para você, quer ver? 💛",
  RECOMPRA:
    "Oi {nome}! Tudo bem? Chegaram peças novas que têm a sua cara 😍 Quer que eu te mande o catálogo?",
  POS_VENDA:
    "Oi {nome}! Seu pedido já chegou? Queria muito saber o que você achou das peças 💛",
  NOVA:
    "Oi {nome}! Tudo bem? Vi que você chegou até a gente 😊 Me conta o que você está procurando que eu te ajudo!",
  PARADA:
    "Oi {nome}! Passando para saber o que você achou das peças 😊 Ficou com alguma dúvida de tamanho ou cor?",
};

/** Rótulo e explicação de cada mensagem, para a tela de configuração. */
export const DESCRICAO_CHAMADA: Record<
  TipoChamada,
  { titulo: string; quando: string }
> = {
  ANIVERSARIO: {
    titulo: "🎂 Aniversário",
    quando: "Enviada no dia (ou até 3 dias antes) do aniversário da cliente.",
  },
  RECOMPRA: {
    titulo: "🔁 Está na hora de comprar de novo",
    quando:
      "Quando a cliente passa do próprio ritmo de compra — o sistema aprende de quanto em quanto tempo cada uma costuma comprar.",
  },
  POS_VENDA: {
    titulo: "📦 Pós-venda",
    quando: "Alguns dias depois de a venda ser fechada, para saber se chegou bem.",
  },
  NOVA: {
    titulo: "👋 Cliente nova",
    quando: "Lead que chegou e ainda não recebeu nenhum contato.",
  },
  PARADA: {
    titulo: "💬 Conversa parada",
    quando: "Recebeu o catálogo ou parou de responder há alguns dias.",
  },
};

/** Nome do campo em CommSettings para cada tipo. */
export const CAMPO_DA_CHAMADA: Record<TipoChamada, string> = {
  ANIVERSARIO: "msgAniversario",
  RECOMPRA: "msgRecompra",
  POS_VENDA: "msgPosVenda",
  NOVA: "msgPrimeiroContato",
  PARADA: "msgConversaParada",
};

/**
 * Troca as variáveis pelo valor real. Variável que a loja não usou some do
 * texto sem deixar buraco, e variável desconhecida fica como está (melhor a
 * lojista ver "{tamanho}" e entender do que a mensagem sair estranha).
 */
export function montarMensagem(
  tipo: TipoChamada,
  vars: VariaveisChamada,
  personalizada?: string | null
): string {
  const base = (personalizada?.trim() || MENSAGEM_PADRAO[tipo]).trim();
  return base
    .replace(/\{nome\}/g, vars.nome)
    .replace(/\{dias\}/g, vars.dias != null ? String(vars.dias) : "");
}

/** Traduz a chave da regra da automação no tipo de mensagem. */
export function tipoDaRegra(regra: string): TipoChamada {
  switch (regra) {
    case "aniversario":
      return "ANIVERSARIO";
    case "recompra":
      return "RECOMPRA";
    case "pos-venda":
      return "POS_VENDA";
    case "primeiro-contato":
      return "NOVA";
    default:
      return "PARADA";
  }
}
