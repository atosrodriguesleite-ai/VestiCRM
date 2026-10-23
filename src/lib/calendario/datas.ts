/**
 * CALENDÁRIO COMERCIAL — AS DATAS DO SISTEMA (RN-092, 23/10/2026).
 *
 * Regra PURA, sem banco: o navegador e o servidor fazem a mesma conta.
 *
 * Três decisões, combinadas com o dono:
 *  1. As datas do sistema são CALCULADAS, nunca gravadas ano a ano. Páscoa,
 *     Carnaval, Dia das Mães, Dia dos Pais e Black Friday mudam de dia todo
 *     ano; digitadas, um dia alguém esqueceria de digitar o ano seguinte e a
 *     loja perderia a data. Calculadas, o calendário do ano que vem já existe.
 *  2. Há DUAS listas do sistema: as COMERCIAIS (nacionais, valem para toda
 *     loja) e as de OPORTUNIDADE (por SEGMENTO — moda praia tem o verão,
 *     fitness tem janeiro, infantil tem a volta às aulas). A loja escolhe os
 *     segmentos dela; a lista é FECHADA e mantida aqui, sem inteligência
 *     artificial (régua do Estoque, RN-052: conta que a lojista confere).
 *  3. O sistema atende atacado E varejo, então "quando começar" é da LOJA:
 *     cada uma diz quantos dias antes quer ser avisada (45, 60, 15…), e cada
 *     data pode ter a sua.
 *
 * Datas como texto "AAAA-MM-DD" (o dia, sem fuso): comparar e somar dias em
 * texto não tem a armadilha da meia-noite UTC (lib/dia.ts explica).
 */

export type TipoDaData = "COMERCIAL" | "OPORTUNIDADE" | "LANCAMENTO";

/** "2026-05-10" a partir de ano, mês (1–12) e dia. */
function texto(ano: number, mes: number, dia: number): string {
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Soma dias a um dia em texto (negativo volta). */
export function somarDias(dia: string, n: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d + n));
  return texto(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Quantos dias de `de` até `ate` (positivo se `ate` vem depois). */
export function diasEntre(de: string, ate: string): number {
  const [a1, m1, d1] = de.split("-").map(Number);
  const [a2, m2, d2] = ate.split("-").map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86_400_000);
}

/**
 * Domingo de Páscoa (calendário gregoriano, algoritmo de Meeus/Jones/Butcher).
 * É dela que saem o Carnaval (47 dias antes) e a Sexta-feira Santa.
 */
export function pascoa(ano: number): string {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return texto(ano, mes, dia);
}

/** O N-ésimo dia da semana (0 = domingo) de um mês: "2º domingo de maio". */
export function enesimoDiaDaSemana(ano: number, mes: number, diaDaSemana: number, n: number): string {
  const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const dia = 1 + ((diaDaSemana - primeiro + 7) % 7) + (n - 1) * 7;
  return texto(ano, mes, dia);
}

/** Como a data cai no ano. */
type Regra =
  | { fixa: [mes: number, dia: number] }
  | { calcula: (ano: number) => string };

export type DataDoSistema = {
  /** chave ESTÁVEL (é o que fica gravado em datas escondidas e anotações) */
  chave: string;
  titulo: string;
  regra: Regra;
  /** uma linha que diz por que a data importa — aparece na tela */
  dica: string;
};

const fixa = (mes: number, dia: number): Regra => ({ fixa: [mes, dia] });

/**
 * AS COMERCIAIS: valem para toda loja. A ordem não importa (a tela ordena
 * pela data).
 */
export const DATAS_COMERCIAIS: DataDoSistema[] = [
  {
    chave: "carnaval",
    titulo: "Carnaval",
    regra: { calcula: (ano) => somarDias(pascoa(ano), -47) },
    dica: "Terça-feira de Carnaval. Fantasia, body, peças leves e com brilho.",
  },
  { chave: "dia-da-mulher", titulo: "Dia Internacional da Mulher", regra: fixa(3, 8), dica: "Presente e autoestima: ação para a cliente e para a revendedora." },
  { chave: "dia-do-consumidor", titulo: "Dia do Consumidor", regra: fixa(3, 15), dica: "A \"Black Friday do 1º semestre\": promoção e condição especial." },
  {
    chave: "pascoa",
    titulo: "Páscoa",
    regra: { calcula: pascoa },
    dica: "Feriado prolongado: viagem, família e look para o almoço de domingo.",
  },
  {
    chave: "dia-das-maes",
    titulo: "Dia das Mães",
    regra: { calcula: (ano) => enesimoDiaDaSemana(ano, 5, 0, 2) },
    dica: "2º domingo de maio. A data mais forte do 1º semestre na moda.",
  },
  { chave: "dia-dos-namorados", titulo: "Dia dos Namorados", regra: fixa(6, 12), dica: "Presente, lingerie, peça especial para sair." },
  { chave: "sao-joao", titulo: "São João", regra: fixa(6, 24), dica: "Festas juninas: xadrez, jeans e looks de arraiá — muito forte no Nordeste." },
  {
    chave: "dia-dos-pais",
    titulo: "Dia dos Pais",
    regra: { calcula: (ano) => enesimoDiaDaSemana(ano, 8, 0, 2) },
    dica: "2º domingo de agosto. Moda masculina e presente.",
  },
  { chave: "dia-do-cliente", titulo: "Dia do Cliente", regra: fixa(9, 15), dica: "Relacionamento: brinde, cupom, mensagem para a carteira." },
  { chave: "dia-das-criancas", titulo: "Dia das Crianças", regra: fixa(10, 12), dica: "Moda infantil e presente." },
  {
    chave: "black-friday",
    titulo: "Black Friday",
    // a sexta depois da 4ª quinta-feira de novembro (segue a dos EUA)
    regra: { calcula: (ano) => somarDias(enesimoDiaDaSemana(ano, 11, 4, 4), 1) },
    dica: "Sexta depois da 4ª quinta de novembro (a da Black Friday americana). A maior data de promoção do ano.",
  },
  { chave: "natal", titulo: "Natal", regra: fixa(12, 25), dica: "Presente, look de festa e roupa nova para a virada." },
  { chave: "reveillon", titulo: "Réveillon", regra: fixa(12, 31), dica: "Roupa branca e peça de festa: costuma vender junto com o Natal." },
];

export type Segmento = {
  chave: string;
  nome: string;
  datas: DataDoSistema[];
};

/**
 * AS DE OPORTUNIDADE, por segmento. Lista FECHADA, revisada com o dono: só
 * entram datas conhecidas — data inventada faria a loja se planejar para o
 * que não existe. A mesma data em dois segmentos tem a MESMA chave e
 * aparece uma vez só.
 */
const outonoInverno: DataDoSistema = {
  chave: "estacao-outono",
  titulo: "Começo do outono",
  regra: fixa(3, 20),
  dica: "Troca de estação: hora da coleção outono-inverno estar na vitrine.",
};
const inverno: DataDoSistema = {
  chave: "estacao-inverno",
  titulo: "Começo do inverno",
  regra: fixa(6, 21),
  dica: "Frio de verdade: casacos, malhas e pijamas quentes.",
};
const primaveraVerao: DataDoSistema = {
  chave: "estacao-primavera",
  titulo: "Começo da primavera",
  regra: fixa(9, 22),
  dica: "Troca de estação: hora da coleção primavera-verão.",
};
const verao: DataDoSistema = {
  chave: "estacao-verao",
  titulo: "Começo do verão",
  regra: fixa(12, 21),
  dica: "Alta de moda praia, peças leves e looks de férias.",
};
const voltaAsAulas: DataDoSistema = {
  chave: "volta-as-aulas",
  titulo: "Volta às aulas",
  // 1ª segunda-feira de fevereiro: a data muda por rede de ensino, e esta é
  // a referência — a loja ajusta a antecedência se a cidade dela volta antes
  regra: { calcula: (ano) => enesimoDiaDaSemana(ano, 2, 1, 1) },
  dica: "Referência: 1ª segunda de fevereiro (cada cidade tem a sua data).",
};
const voltaAsAulas2: DataDoSistema = {
  chave: "volta-as-aulas-2",
  titulo: "Volta às aulas (2º semestre)",
  regra: { calcula: (ano) => enesimoDiaDaSemana(ano, 8, 1, 1) },
  dica: "Referência: 1ª segunda de agosto.",
};
const feriasDeJulho: DataDoSistema = {
  chave: "ferias-de-julho",
  titulo: "Férias de julho",
  regra: fixa(7, 1),
  dica: "Viagem e passeio: peças confortáveis e looks de férias.",
};
const formaturas: DataDoSistema = {
  chave: "formaturas",
  titulo: "Temporada de formaturas",
  regra: fixa(12, 1),
  dica: "Dezembro concentra formaturas: vestidos, conjuntos e acessórios de festa.",
};
const anoNovoMetas: DataDoSistema = {
  chave: "metas-de-ano-novo",
  titulo: "Janeiro das metas (academia)",
  regra: fixa(1, 5),
  dica: "Começo do ano: a academia lota e a roupa fitness vende.",
};
const projetoVerao: DataDoSistema = {
  chave: "projeto-verao",
  titulo: "Projeto verão",
  regra: fixa(9, 1),
  dica: "Setembro: quem vai para a praia no verão começa a treinar.",
};
const educacaoFisica: DataDoSistema = {
  chave: "dia-educacao-fisica",
  titulo: "Dia do Profissional de Educação Física",
  regra: fixa(9, 1),
  dica: "Ação com personal trainers e academias parceiras.",
};
const diaDoHomem: DataDoSistema = {
  chave: "dia-do-homem",
  titulo: "Dia do Homem",
  regra: fixa(7, 15),
  dica: "Ação de moda masculina entre o Dia dos Namorados e o dos Pais.",
};
const diaDoJeans: DataDoSistema = {
  chave: "dia-do-jeans",
  titulo: "Dia do Jeans",
  regra: fixa(5, 20),
  dica: "Data de vitrine para quem trabalha com jeans.",
};
const diaDaGestante: DataDoSistema = {
  chave: "dia-da-gestante",
  titulo: "Dia da Gestante",
  regra: fixa(8, 15),
  dica: "Moda gestante e enxoval.",
};
const saoPedro: DataDoSistema = {
  chave: "sao-pedro",
  titulo: "São Pedro",
  regra: fixa(6, 29),
  dica: "Fecha o ciclo junino: última leva de looks de arraiá.",
};
const santoAntonio: DataDoSistema = {
  chave: "santo-antonio",
  titulo: "Santo Antônio",
  regra: fixa(6, 13),
  dica: "Abre o ciclo junino: o \"casamenteiro\", junto com o Dia dos Namorados.",
};

export const SEGMENTOS: Segmento[] = [
  { chave: "feminina", nome: "Moda feminina", datas: [outonoInverno, inverno, primaveraVerao, verao] },
  { chave: "masculina", nome: "Moda masculina", datas: [diaDoHomem, outonoInverno, primaveraVerao] },
  { chave: "infantil", nome: "Moda infantil", datas: [voltaAsAulas, feriasDeJulho, voltaAsAulas2] },
  { chave: "praia", nome: "Moda praia", datas: [verao, feriasDeJulho] },
  { chave: "fitness", nome: "Fitness", datas: [anoNovoMetas, projetoVerao, educacaoFisica, verao] },
  { chave: "plus-size", nome: "Plus size", datas: [outonoInverno, inverno, primaveraVerao, verao] },
  { chave: "festa", nome: "Moda festa", datas: [formaturas] },
  { chave: "intima", nome: "Moda íntima e pijamas", datas: [inverno] },
  { chave: "jeans", nome: "Jeans", datas: [diaDoJeans] },
  { chave: "gestante", nome: "Moda gestante", datas: [diaDaGestante] },
  { chave: "junina", nome: "Junina e country", datas: [santoAntonio, saoPedro] },
  { chave: "semijoias", nome: "Semijoias e acessórios", datas: [formaturas] },
];

export const SEGMENTO_POR_CHAVE = new Map(SEGMENTOS.map((s) => [s.chave, s]));

/** Só segmentos que existem (o que vem do banco ou da tela é conferido). */
export function segmentosValidos(chaves: readonly string[]): string[] {
  return [...new Set(chaves)].filter((c) => SEGMENTO_POR_CHAVE.has(c));
}

/** Toda data do sistema que existe, por chave (as escondidas são conferidas aqui). */
export const DATA_DO_SISTEMA_POR_CHAVE = new Map<string, { data: DataDoSistema; tipo: TipoDaData }>([
  ...DATAS_COMERCIAIS.map((d) => [d.chave, { data: d, tipo: "COMERCIAL" as TipoDaData }] as const),
  ...SEGMENTOS.flatMap((s) => s.datas).map((d) => [d.chave, { data: d, tipo: "OPORTUNIDADE" as TipoDaData }] as const),
]);

/** O dia da data do sistema naquele ano. */
export function diaDaData(d: DataDoSistema, ano: number): string {
  return "fixa" in d.regra ? texto(ano, d.regra.fixa[0], d.regra.fixa[1]) : d.regra.calcula(ano);
}

/** Uma ocorrência no calendário: data do sistema num ano, ou data da loja. */
export type Ocorrencia = {
  /** "sis:dia-das-maes:2027" ou "loja:<id do evento>" — único na lista */
  id: string;
  tipo: TipoDaData;
  titulo: string;
  dia: string;
  dica: string | null;
  /** data do sistema: a chave e o ano (para anotar e esconder) */
  chaveSistema: string | null;
  ano: number;
  /** quem nomeou a data: os segmentos que a trouxeram (oportunidade) */
  segmentos: string[];
  /** id do CalendarioEvento (data da loja, ou anotação da data do sistema) */
  eventoId: string | null;
  /** nulo = segue a da loja */
  antecedenciaPropria: number | null;
  notas: string;
  tarefas: { id: string; texto: string; feita: boolean; feitaPorNome: string | null }[];
  avisadoEm: string | null;
};

/** O que vem do banco para montar o calendário (data da loja OU anotação). */
export type EventoGravado = {
  id: string;
  tipo: TipoDaData;
  titulo: string;
  /** "AAAA-MM-DD" */
  dia: string;
  antecedenciaDias: number | null;
  notas: string;
  chaveSistema: string | null;
  ano: number | null;
  avisadoEm: string | null;
  tarefas: { id: string; texto: string; feita: boolean; feitaPorNome: string | null }[];
};

/**
 * Monta o calendário de um intervalo de dias: as datas do sistema que caem
 * nele (comerciais + as dos segmentos da loja, fora as escondidas) e as datas
 * da loja, com as anotações penduradas nas datas do sistema. Ordenado pelo
 * dia; no mesmo dia, comercial antes de oportunidade antes de lançamento.
 */
export function montarOcorrencias(entrada: {
  de: string;
  ate: string;
  segmentos: readonly string[];
  ocultas: readonly string[];
  eventos: readonly EventoGravado[];
}): Ocorrencia[] {
  const { de, ate } = entrada;
  const ocultas = new Set(entrada.ocultas);
  const anoDe = Number(de.slice(0, 4));
  const anoAte = Number(ate.slice(0, 4));

  // as do sistema que a loja vê: comerciais + as dos segmentos dela
  const doSistema = new Map<string, { data: DataDoSistema; tipo: TipoDaData; segmentos: string[] }>();
  for (const d of DATAS_COMERCIAIS) doSistema.set(d.chave, { data: d, tipo: "COMERCIAL", segmentos: [] });
  for (const chaveSeg of segmentosValidos(entrada.segmentos)) {
    const seg = SEGMENTO_POR_CHAVE.get(chaveSeg)!;
    for (const d of seg.datas) {
      const ja = doSistema.get(d.chave);
      if (ja) {
        if (ja.tipo === "OPORTUNIDADE" && !ja.segmentos.includes(seg.nome)) ja.segmentos.push(seg.nome);
      } else doSistema.set(d.chave, { data: d, tipo: "OPORTUNIDADE", segmentos: [seg.nome] });
    }
  }

  const anotacoes = new Map<string, EventoGravado>();
  for (const e of entrada.eventos) {
    if (e.chaveSistema && e.ano != null) anotacoes.set(`${e.chaveSistema}:${e.ano}`, e);
  }

  const lista: Ocorrencia[] = [];
  for (const { data, tipo, segmentos } of doSistema.values()) {
    if (ocultas.has(data.chave)) continue;
    for (let ano = anoDe; ano <= anoAte; ano++) {
      const dia = diaDaData(data, ano);
      if (dia < de || dia > ate) continue;
      const an = anotacoes.get(`${data.chave}:${ano}`);
      lista.push({
        id: `sis:${data.chave}:${ano}`,
        tipo,
        titulo: data.titulo,
        dia,
        dica: data.dica,
        chaveSistema: data.chave,
        ano,
        segmentos,
        eventoId: an?.id ?? null,
        antecedenciaPropria: an?.antecedenciaDias ?? null,
        notas: an?.notas ?? "",
        tarefas: an?.tarefas ?? [],
        avisadoEm: an?.avisadoEm ?? null,
      });
    }
  }
  for (const e of entrada.eventos) {
    if (e.chaveSistema) continue;
    if (e.dia < de || e.dia > ate) continue;
    lista.push({
      id: `loja:${e.id}`,
      tipo: e.tipo,
      titulo: e.titulo,
      dia: e.dia,
      dica: null,
      chaveSistema: null,
      ano: Number(e.dia.slice(0, 4)),
      segmentos: [],
      eventoId: e.id,
      antecedenciaPropria: e.antecedenciaDias,
      notas: e.notas,
      tarefas: e.tarefas,
      avisadoEm: e.avisadoEm,
    });
  }
  const ordemDoTipo: Record<TipoDaData, number> = { COMERCIAL: 0, OPORTUNIDADE: 1, LANCAMENTO: 2 };
  return lista.sort(
    (a, b) => a.dia.localeCompare(b.dia) || ordemDoTipo[a.tipo] - ordemDoTipo[b.tipo] || a.titulo.localeCompare(b.titulo)
  );
}

/** A antecedência que vale para esta data: a dela, ou a da loja. */
export function antecedenciaDe(o: Pick<Ocorrencia, "antecedenciaPropria">, daLoja: number): number {
  return o.antecedenciaPropria ?? daLoja;
}

/** O dia de COMEÇAR (preparar, produzir, oferecer): a data − a antecedência. */
export function inicioDe(o: Pick<Ocorrencia, "dia" | "antecedenciaPropria">, daLoja: number): string {
  return somarDias(o.dia, -antecedenciaDe(o, daLoja));
}

/**
 * Em que pé a data está hoje:
 *  - "agora": já passou do dia de começar e a data ainda não chegou — é a
 *    janela de trabalho, e é por ela que o lembrete sai;
 *  - "em-breve": ainda não é hora de começar;
 *  - "hoje": é o dia;
 *  - "passou".
 */
export type SituacaoDaData = "em-breve" | "agora" | "hoje" | "passou";
export function situacaoDe(
  o: Pick<Ocorrencia, "dia" | "antecedenciaPropria">,
  daLoja: number,
  hoje: string
): SituacaoDaData {
  if (o.dia < hoje) return "passou";
  if (o.dia === hoje) return "hoje";
  return inicioDe(o, daLoja) <= hoje ? "agora" : "em-breve";
}

/**
 * Quais datas ganham o lembrete "é hora de começar" nesta rodada: as que
 * estão na janela de trabalho (ou no próprio dia) e ainda não foram
 * avisadas. Uma data avisa UMA vez — o carimbo `avisadoEm` é o que segura;
 * mudar a data ou a antecedência dela apaga o carimbo (quem grava cuida).
 */
export function paraAvisar(lista: readonly Ocorrencia[], daLoja: number, hoje: string): Ocorrencia[] {
  return lista.filter((o) => {
    if (o.avisadoEm) return false;
    const s = situacaoDe(o, daLoja, hoje);
    return s === "agora" || s === "hoje";
  });
}

/** O texto do lembrete (puro): título e corpo, em português de loja. */
export function textoDoLembrete(
  datas: readonly Pick<Ocorrencia, "titulo" | "dia">[],
  hoje: string
): { title: string; body: string } {
  const fmt = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  const quando = (dia: string) => {
    const n = diasEntre(hoje, dia);
    return n <= 0 ? "é hoje" : n === 1 ? "falta 1 dia" : `faltam ${n} dias`;
  };
  if (datas.length === 1) {
    const d = datas[0];
    return {
      title: `📅 Hora de começar: ${d.titulo}`,
      body: `${d.titulo} (${fmt(d.dia)}) — ${quando(d.dia)}. Veja as tarefas no Calendário comercial.`,
    };
  }
  const nomes = datas.slice(0, 3).map((d) => `${d.titulo} (${fmt(d.dia)})`);
  const resto = datas.length - nomes.length;
  return {
    title: `📅 ${datas.length} datas chegando`,
    body: `${nomes.join(", ")}${resto > 0 ? ` e mais ${resto}` : ""}. Hora de começar — veja no Calendário comercial.`,
  };
}

/** O intervalo da TELA: do 1º dia do mês corrente até o fim do 12º mês. */
export function intervaloDaTela(hoje: string): { de: string; ate: string } {
  const de = `${hoje.slice(0, 7)}-01`;
  const [a, m] = de.split("-").map(Number);
  // último dia do mês 11 meses depois = dia 0 do mês seguinte a ele
  const fim = new Date(Date.UTC(a, m - 1 + 12, 0));
  return { de, ate: fim.toISOString().slice(0, 10) };
}

/**
 * A janela que o LEMBRETE olha: de hoje até onde a maior antecedência
 * possível alcança (uma data a 365 dias com antecedência de 365 começa hoje).
 */
export function janelaDoLembrete(hoje: string): { de: string; ate: string } {
  // a MESMA janela da tela daqui em diante: o lembrete nunca aponta para
  // uma data que o Calendário não mostra (achado da revisão)
  return { de: hoje, ate: intervaloDaTela(hoje).ate };
}

/**
 * A data da loja tem que caber na janela da TELA (do começo do mês até o fim
 * do 12º mês): criada fora dela, sumia da lista ao salvar e parecia que não
 * tinha gravado — a pessoa criava de novo (achado da revisão). Devolve a
 * frase da recusa, ou null quando cabe.
 */
export function foraDaJanela(dia: string, hoje: string): string | null {
  const { de, ate } = intervaloDaTela(hoje);
  const fmt = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  if (dia < de) return `O calendário começa em ${fmt(de)} — escolha uma data a partir daí.`;
  if (dia > ate) return `O calendário mostra até ${fmt(ate)}. Crie esta data mais perto do dia.`;
  return null;
}

/** Limites conferidos na tela E na porta (a porta é a segunda tranca). */
export const LIMITES = {
  antecedenciaMax: 365,
  titulo: 80,
  notas: 2000,
  tarefa: 200,
  tarefasPorData: 50,
  datasDaLoja: 500,
} as const;
