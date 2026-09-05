/**
 * A NOTA DE SAÚDE FINANCEIRA DA LOJA (RN-035) — regra PURA, sem banco.
 *
 * O painel mostra um número de 0 a 100 e QUATRO frases. O número existe para
 * a lojista bater o olho; as frases existem para ela saber O QUE olhar — nota
 * sem explicação é adivinhação com cara de ciência. Por isso cada sinal vale
 * a mesma coisa (25 pontos), diz em português o que mediu e aponta o
 * caminho quando está ruim. Nada aqui é dinheiro andando: é leitura do que
 * as outras telas já somam (saldo, previsão, atrasado, entrou/saiu do mês).
 *
 * Os quatro sinais são as quatro perguntas de quem toca uma loja de atacado:
 *
 *  1. TENHO DINHEIRO PARA A SEMANA? — o saldo de hoje cobre o que vence nos
 *     próximos 7 dias? (é a conta que a lojista faz de cabeça na segunda)
 *  2. O MÊS FECHA? — saldo + o que entra em 30 dias cobre o que sai em 30?
 *  3. ESTÃO ME PAGANDO? — de tudo que há para receber, quanto já venceu?
 *  4. ESTOU GANHANDO OU PERDENDO? — no mês, entrou mais do que saiu?
 */

export type EntradaDaSaude = {
  /** saldo somado das contas, hoje (RN-032) */
  saldoHoje: number;
  /** o que FALTA pagar com vencimento nos próximos 7 dias (atrasado incluído) */
  aPagar7: number;
  /** o que FALTA receber/pagar nos próximos 30 dias (atrasado incluído, RN-035) */
  aReceber30: number;
  aPagar30: number;
  /** o que já venceu e não foi recebido */
  atrasado: number;
  /** tudo que há para receber em aberto no horizonte olhado (inclui o atrasado) */
  aReceberEmAberto: number;
  /** o que ENTROU e SAIU de verdade nas contas no mês até hoje */
  entradasMes: number;
  saidasMes: number;
};

export type TomDaSaude = "bom" | "atencao" | "ruim";

export type SinalDaSaude = {
  titulo: string;
  frase: string;
  pontos: number;
  maximo: number;
  tom: TomDaSaude;
};

export type SaudeFinanceira = {
  nota: number;
  rotulo: string;
  tom: TomDaSaude;
  sinais: SinalDaSaude[];
};

export const MAXIMO_POR_SINAL = 25;

const brl = (v: number) =>
  v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });

const pct = (v: number) =>
  `${v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 })}%`;

function tomDosPontos(pontos: number): TomDaSaude {
  if (pontos >= 20) return "bom";
  if (pontos >= 10) return "atencao";
  return "ruim";
}

function sinal(titulo: string, pontos: number, frase: string): SinalDaSaude {
  return { titulo, frase, pontos, maximo: MAXIMO_POR_SINAL, tom: tomDosPontos(pontos) };
}

/** 1. Tenho dinheiro para a semana? */
function sinalDaSemana(e: EntradaDaSaude): SinalDaSaude {
  const titulo = "Dinheiro para a semana";
  if (e.saldoHoje < 0)
    return sinal(titulo, 0, `O saldo de hoje está negativo (${brl(e.saldoHoje)}).`);
  if (e.aPagar7 <= 0)
    return sinal(titulo, MAXIMO_POR_SINAL, "Nada vence nos próximos 7 dias.");
  const razao = e.saldoHoje / e.aPagar7;
  if (razao >= 1)
    return sinal(
      titulo,
      MAXIMO_POR_SINAL,
      `O saldo de hoje cobre os ${brl(e.aPagar7)} que vencem em 7 dias.`
    );
  if (razao >= 0.5)
    return sinal(
      titulo,
      12,
      `O saldo cobre só ${pct(razao * 100)} dos ${brl(e.aPagar7)} que vencem em 7 dias.`
    );
  return sinal(
    titulo,
    0,
    `Faltam ${brl(e.aPagar7 - e.saldoHoje)} para o que vence em 7 dias — veja o que dá para receber antes.`
  );
}

/** 2. O mês fecha? */
function sinalDoMes(e: EntradaDaSaude): SinalDaSaude {
  const titulo = "Os próximos 30 dias";
  const disponivel = e.saldoHoje + e.aReceber30;
  if (e.aPagar30 <= 0) {
    return disponivel >= 0
      ? sinal(titulo, MAXIMO_POR_SINAL, "Nada a pagar nos próximos 30 dias.")
      : sinal(titulo, 0, "Nada a pagar, mas o saldo está negativo.");
  }
  const cobertura = disponivel / e.aPagar30;
  if (cobertura >= 1.2)
    return sinal(
      titulo,
      MAXIMO_POR_SINAL,
      `Saldo + a receber cobrem o que sai em 30 dias com ${pct((cobertura - 1) * 100)} de folga.`
    );
  if (cobertura >= 1)
    return sinal(
      titulo,
      18,
      "Saldo + a receber cobrem o que sai em 30 dias, mas com pouca folga."
    );
  if (cobertura >= 0.8)
    return sinal(
      titulo,
      10,
      `Saldo + a receber cobrem ${pct(cobertura * 100)} do que sai em 30 dias.`
    );
  return sinal(
    titulo,
    0,
    `Faltam ${brl(e.aPagar30 - disponivel)} para fechar os próximos 30 dias.`
  );
}

/** 3. Estão me pagando? */
function sinalDoAtraso(e: EntradaDaSaude): SinalDaSaude {
  const titulo = "Recebimentos em dia";
  if (e.aReceberEmAberto <= 0 || e.atrasado <= 0)
    return sinal(titulo, MAXIMO_POR_SINAL, "Nenhuma conta a receber atrasada.");
  const parte = Math.min(1, e.atrasado / e.aReceberEmAberto);
  if (parte < 0.05)
    return sinal(
      titulo,
      20,
      `${brl(e.atrasado)} atrasados — ${pct(parte * 100)} do que há para receber.`
    );
  if (parte < 0.15)
    return sinal(
      titulo,
      12,
      `${brl(e.atrasado)} atrasados (${pct(parte * 100)} do que há para receber) — vale cobrar.`
    );
  if (parte < 0.3)
    return sinal(
      titulo,
      5,
      `${pct(parte * 100)} do que há para receber já venceu (${brl(e.atrasado)}).`
    );
  return sinal(
    titulo,
    0,
    `${pct(parte * 100)} do que há para receber está atrasado (${brl(e.atrasado)}) — cobrar é a prioridade.`
  );
}

/** 4. Estou ganhando ou perdendo? */
function sinalDoResultado(e: EntradaDaSaude): SinalDaSaude {
  const titulo = "Entrou mais do que saiu";
  if (e.entradasMes <= 0 && e.saidasMes <= 0)
    return sinal(titulo, 12, "Ainda não houve movimento nas contas neste mês.");
  const resultado = e.entradasMes - e.saidasMes;
  if (e.saidasMes <= 0)
    return sinal(titulo, MAXIMO_POR_SINAL, `Entraram ${brl(e.entradasMes)} e nada saiu até agora.`);
  const razao = e.entradasMes / e.saidasMes;
  if (razao >= 1.1)
    return sinal(titulo, MAXIMO_POR_SINAL, `No mês, entrou ${brl(resultado)} a mais do que saiu.`);
  if (razao >= 1)
    return sinal(titulo, 18, "No mês, entrou e saiu quase a mesma coisa.");
  if (razao >= 0.9)
    return sinal(titulo, 10, `No mês, saiu ${brl(-resultado)} a mais do que entrou.`);
  return sinal(
    titulo,
    0,
    `No mês, saiu ${brl(-resultado)} a mais do que entrou — veja "Para onde foi o dinheiro".`
  );
}

export function rotuloDaNota(nota: number): { rotulo: string; tom: TomDaSaude } {
  if (nota >= 80) return { rotulo: "Saudável", tom: "bom" };
  if (nota >= 60) return { rotulo: "Atenção", tom: "atencao" };
  if (nota >= 40) return { rotulo: "Apertada", tom: "atencao" };
  return { rotulo: "Crítica", tom: "ruim" };
}

export function avaliarSaude(e: EntradaDaSaude): SaudeFinanceira {
  const sinais = [sinalDaSemana(e), sinalDoMes(e), sinalDoAtraso(e), sinalDoResultado(e)];
  const nota = sinais.reduce((s, x) => s + x.pontos, 0);
  return { nota, ...rotuloDaNota(nota), sinais };
}
