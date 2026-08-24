/**
 * Motor de indicadores da PLATAFORMA (painel de gestão do Super Admin).
 *
 * Aqui moram as contas de negócio do AtacadoPro enquanto empresa: quanto cada
 * loja paga, quanto entra por mês, há quanto tempo cada cliente está com a
 * gente e quanto as lojas movimentam dentro do sistema.
 *
 * As funções puras ficam separadas das consultas de propósito: é o que
 * permite travar as regras em teste sem precisar de banco.
 */

import { billingStatus } from "./billing";

/**
 * Partes da data no FUSO OFICIAL do produto (São Paulo).
 *
 * O servidor roda em UTC. Sem fixar o fuso, entre 21h e meia-noite de
 * Brasília o sistema já está no dia seguinte — e a loja "faria aniversário"
 * ou "venceria" 3 horas antes da hora.
 */
function partesSP(d: Date): { y: number; m: number; dia: number } {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return { y: get("year"), m: get("month"), dia: get("day") };
}

/**
 * Fonte usada no ErrorLog para AÇÕES do Super Admin (ex.: exclusão de loja).
 * Fica gravado para sempre — mas não é defeito do sistema, então não entra
 * na conta de intercorrências nem acende alarme na aba Sistema.
 */
export const FONTE_AUDITORIA = "auditoria";

/**
 * LOJA DE DEMONSTRAÇÃO (a "Bella Moda", criada por scripts/seed-demo.ts).
 *
 * Ela existe para APRESENTAR o sistema, então tem cliente, pedido e
 * faturamento de mentira — todos coerentes de propósito. Por isso ela não
 * pode entrar nas contas da plataforma: contar o faturamento dela junto com
 * o das lojas reais faria o painel dizer que os clientes venderam um dinheiro
 * que ninguém vendeu. Aparece na lista de lojas (é preciso administrá-la),
 * mas fica FORA de todo indicador.
 */
export const SLUG_LOJA_DEMO = "bella-moda-demo";
export const ehLojaDemo = (slug: string) => slug === SLUG_LOJA_DEMO;

/** Ciclos de contrato aceitos (como a recorrência é cobrada). */
export const CICLOS = ["MENSAL", "SEMESTRAL", "ANUAL"] as const;
export type Ciclo = (typeof CICLOS)[number];

export const cicloLabel: Record<string, string> = {
  MENSAL: "Mensal",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
};

/** Quantos meses cada cobrança cobre. */
export const mesesDoCiclo = (ciclo: string): number =>
  ciclo === "ANUAL" ? 12 : ciclo === "SEMESTRAL" ? 6 : 1;

/**
 * Valor de CADA COBRANÇA do contrato. A mensalidade é a régua (MRR); quem
 * paga semestral desembolsa 6x de uma vez, quem paga anual, 12x.
 */
export const valorDaCobranca = (monthlyFee: number, ciclo: string): number =>
  monthlyFee * mesesDoCiclo(ciclo);

/**
 * LIFETIME em meses: há quanto tempo a loja é cliente.
 * Conta meses cheios e nunca devolve negativo (loja criada "no futuro" por
 * erro de fuso não vira -1).
 */
export function lifetimeMeses(criadaEm: Date, agora = new Date()): number {
  const a = partesSP(criadaEm);
  const b = partesSP(agora);
  const meses = (b.y - a.y) * 12 + (b.m - a.m) - (b.dia < a.dia ? 1 : 0);
  return Math.max(0, meses);
}

/** Rótulo humano do tempo de casa ("3 meses", "1 ano e 2 meses"). */
export function lifetimeLabel(meses: number): string {
  if (meses <= 0) return "menos de 1 mês";
  if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`;
  const anos = Math.floor(meses / 12);
  const resto = meses % 12;
  const a = `${anos} ${anos === 1 ? "ano" : "anos"}`;
  return resto ? `${a} e ${resto} ${resto === 1 ? "mês" : "meses"}` : a;
}

/**
 * VALOR JÁ GERADO pelo cliente (implementação paga + recorrências pagas).
 * É o "quanto essa loja já nos deu" — a conta que decide quem é cliente
 * importante de verdade.
 */
export function valorGerado(pagamentos: { amount: number }[]): number {
  return pagamentos.reduce((soma, p) => soma + p.amount, 0);
}

export type SituacaoCobranca = "EM_DIA" | "A_VENCER" | "ATRASADO" | "SEM_COBRANCA";

/**
 * Situação da recorrência de uma loja.
 *
 * NÃO refaz a conta: delega para `billingStatus` (lib/billing.ts), que é a
 * régua de cobrança do sistema e já é usada no painel Lojas. Assim o Painel
 * de Gestão e o painel Lojas NUNCA discordam sobre quem está atrasado —
 * duas contas paralelas viram, mais cedo ou mais tarde, dois números
 * diferentes para a mesma loja.
 *
 * Aqui só traduzimos o resultado para os quatro estados desta tela: o que
 * não é régua de cobrança (teste, cortesia, valor não definido) vira
 * "sem cobrança".
 */
export function situacaoCobranca(input: {
  kind: string; // TESTE | PAGANTE | CORTESIA
  monthlyFee: number;
  dueDay: number;
  paidThrough: Date | null;
  hoje?: Date;
}): SituacaoCobranca {
  const status = billingStatus(
    {
      kind: input.kind,
      monthlyFee: input.monthlyFee,
      dueDay: input.dueDay,
      paidThrough: input.paidThrough,
    },
    input.hoje ?? new Date()
  );
  if (status.code === "EM_DIA") return "EM_DIA";
  if (status.code === "A_VENCER") return "A_VENCER";
  if (status.code === "ATRASADO") return "ATRASADO";
  return "SEM_COBRANCA"; // TESTE | VITALICIO (cortesia) | SEM_VALOR
}

export const situacaoLabel: Record<SituacaoCobranca, string> = {
  EM_DIA: "Em dia",
  A_VENCER: "A vencer",
  ATRASADO: "Atrasado",
  SEM_COBRANCA: "Sem cobrança",
};

/**
 * RECEITA RECORRENTE MENSAL (MRR): soma das mensalidades das lojas pagantes
 * ativas. Loja suspensa não conta — não está gerando caixa.
 */
export function calcularMRR(
  lojas: { suspended: boolean; kind: string; monthlyFee: number }[]
): number {
  return lojas
    .filter((l) => !l.suspended && l.kind === "PAGANTE")
    .reduce((soma, l) => soma + l.monthlyFee, 0);
}

/**
 * LOJA EM RISCO — os dois riscos que valem dinheiro, separados porque a ação
 * é diferente:
 *
 * - PAGANTE_SUMIU: cliente que paga e parou de usar. Quem não usa cancela na
 *   próxima fatura. Risco de PERDER uma receita que já existe.
 * - TESTE_PARADO: quem entrou no teste e não está usando. Risco de NÃO
 *   FECHAR uma venda — e é o momento em que ainda dá para salvar.
 *
 * Cortesia fica de fora: não há receita em jogo nem venda a fechar.
 */
export type TipoDeRisco = "PAGANTE_SUMIU" | "TESTE_PARADO";

export const riscoLabel: Record<TipoDeRisco, string> = {
  PAGANTE_SUMIU: "cliente sumindo",
  TESTE_PARADO: "teste parado",
};

/** Pagante: 14 dias sem ninguém entrar já é sinal de cancelamento vindo. */
export const DIAS_RISCO_PAGANTE = 14;
/** Teste: o prazo é mais curto — teste parado esfria rápido. */
export const DIAS_RISCO_TESTE = 7;
/** Tolerância para a loja nova dar o primeiro acesso antes de acender alarme. */
export const DIAS_PRIMEIRO_ACESSO = 2;

export function tipoDeRisco(
  loja: {
    suspended: boolean;
    kind: string;
    ultimoAcesso: Date | null;
    criadaEm: Date;
  },
  hoje = new Date()
): TipoDeRisco | null {
  if (loja.suspended) return null; // suspensa já é outro problema, não "risco"
  const diasDesde = (d: Date) => (hoje.getTime() - d.getTime()) / 86_400_000;

  if (loja.kind === "PAGANTE") {
    // pagante que NUNCA entrou é o pior caso: pagou e não usou
    if (!loja.ultimoAcesso) return "PAGANTE_SUMIU";
    return diasDesde(loja.ultimoAcesso) >= DIAS_RISCO_PAGANTE ? "PAGANTE_SUMIU" : null;
  }

  if (loja.kind === "TESTE") {
    // loja recém-criada tem alguns dias para dar o primeiro acesso
    if (!loja.ultimoAcesso)
      return diasDesde(loja.criadaEm) >= DIAS_PRIMEIRO_ACESSO ? "TESTE_PARADO" : null;
    return diasDesde(loja.ultimoAcesso) >= DIAS_RISCO_TESTE ? "TESTE_PARADO" : null;
  }

  return null; // CORTESIA
}

/**
 * WHATSAPP FORA DO AR — a queda que vira prejuízo.
 *
 * Oscilação de minutos é normal (celular sem sinal, WhatsApp fechado). O que
 * importa é a queda que PERSISTE: com o WhatsApp caído a loja não recebe nem
 * responde nada pelo sistema — o atendimento dela parou, e ela nem sempre
 * percebe. Passando deste limite, o painel avisa em cima.
 */
export const ALERTA_WHATSAPP_HORAS = 2;
/** A partir daqui a queda é grave: um dia inteiro sem atendimento. */
export const ALERTA_WHATSAPP_HORAS_GRAVE = 24;

/** Há quantas horas o número está fora do ar (null = não está caído). */
export function horasForaDoAr(desde: Date | null, agora = new Date()): number | null {
  if (!desde) return null;
  const horas = (agora.getTime() - desde.getTime()) / 3_600_000;
  return horas > 0 ? Math.floor(horas) : 0;
}

/** Rótulo humano do tempo fora do ar ("3 horas", "2 dias"). */
export function tempoForaLabel(horas: number): string {
  if (horas < 1) return "menos de 1 hora";
  if (horas < 24) return `${horas} ${horas === 1 ? "hora" : "horas"}`;
  const dias = Math.floor(horas / 24);
  return `${dias} ${dias === 1 ? "dia" : "dias"}`;
}

/**
 * De onde vieram os leads. A plataforma capta por caminhos diferentes e cada
 * um precisa ser medido separado — é assim que se decide onde investir.
 */
export type CanalDeLead =
  | "LANDING"
  | "BIO"
  | "CATALOGO_PLATAFORMA"
  | "CATALOGO_DE_LOJA"
  | "OUTROS";

export const canalLeadLabel: Record<CanalDeLead, string> = {
  LANDING: "Site / landing page",
  BIO: "Rodapé da bio de uma loja",
  CATALOGO_DE_LOJA: "Rodapé do catálogo de uma loja",
  CATALOGO_PLATAFORMA: "Catálogo da AtacadoPro",
  OUTROS: "Outros canais",
};

/** Separador entre a solicitação nova e a anterior, nas observações do lead. */
export const MARCA_ANTERIOR = "— solicitação anterior —";

/** Teto das observações: guarda o histórico sem deixar o campo crescer sem fim. */
const TETO_NOTAS = 4000;

/**
 * EMPILHA A SOLICITAÇÃO NOVA SOBRE A ANTERIOR.
 *
 * A lojista que pede demonstração duas vezes costuma preencher menos na
 * segunda (só nome e telefone). Substituir as observações apagava o Instagram
 * e o e-mail informados na primeira — dado de contato que não volta. A nova
 * fica em cima (é o que interessa para ligar hoje), a antiga fica embaixo,
 * marcada, e o texto para de crescer no teto.
 */
export function notasEmpilhadas(
  nova: string,
  anterior: string | null | undefined
): string {
  const velha = (anterior ?? "").trim();
  if (!velha) return nova;
  // compara com o BLOCO DE CIMA, não com a pilha inteira: quem manda o mesmo
  // formulário três vezes empilhava três blocos idênticos, porque a partir da
  // segunda a pilha nunca mais era "igual" ao texto novo.
  const topo = velha.split(`\n\n${MARCA_ANTERIOR}\n`)[0]?.trim() ?? "";
  if (topo === nova.trim()) return velha;
  const junto = `${nova}\n\n${MARCA_ANTERIOR}\n${velha}`;
  return junto.length <= TETO_NOTAS ? junto : junto.slice(0, TETO_NOTAS);
}

/**
 * O INSTAGRAM QUE A LOJISTA INFORMOU no formulário de demonstração.
 *
 * O formulário pergunta o Instagram, mas o cadastro de cliente não tem campo
 * para isso (é um CRM de moda: a ficha guarda CPF, endereço, tamanho). O dado
 * fica no resumo da solicitação, gravado nas observações — e é justamente por
 * ali que se confere se a loja existe antes de ligar. Ler dali é melhor do
 * que perder a informação.
 */
export function instagramDoLead(notes: string | null | undefined): string | null {
  // \s incluiria a QUEBRA DE LINHA: com "Instagram:" vazio, o \s* pulava para
  // a linha de baixo e o @ virava "Loja: Bella" (pego pelo teste). Por isso o
  // espaço aqui é só o horizontal, e a captura nunca atravessa a linha.
  const linha = notes?.match(/^Instagram:[^\S\r\n]*([^\r\n]+)$/m)?.[1]?.trim();
  if (!linha) return null;
  // aceita "@loja", "loja" ou o link colado; guarda só o @. O protocolo é
  // OPCIONAL: no celular a lojista cola "instagram.com/bella" sem o https, e
  // exigir o protocolo devolvia "@instagram.com" — um @ que não existe, que
  // ia parar na planilha e no link da tela.
  const arroba = linha
    .replace(/^(https?:\/\/)?(www\.)?instagram\.com\//i, "")
    .replace(/[/?].*$/, "")
    .replace(/^@+/, "")
    .trim();
  return arroba ? `@${arroba}` : null;
}

/**
 * LÊ A MARCA DO LINK que trouxe a visitante até a landing page ("de onde ela
 * veio"), a partir dos utm que o formulário do site junta em uma linha só.
 *
 * Os dois rodapés das lojas mandam gente para cá, cada um com a sua marca:
 *   • bio      → "bio / <slug-da-loja>"
 *   • catálogo → "catalogo / powered-by / <slug-da-loja>"
 *
 * O catálogo NÃO era reconhecido (só a bio): a lojista que descobriu o
 * AtacadoPro no rodapé do catálogo de outra loja entrava como "site" e o
 * canal aparecia ZERADO no painel — justamente o canal que mais interessa.
 *
 * A fonte é a PRIMEIRA parte (o utm_source). Procurar "bio" em qualquer
 * posição faria um utm_campaign chamado "bio" se passar por rodapé de bio.
 * A campanha (o slug da loja) é a ÚLTIMA, porque o catálogo manda um
 * "medium" no meio que a bio não manda.
 */
export function marcaDoLink(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const partes = ref
    .split(/[/·,]/)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  const fonte = ["bio", "catalogo"].find((f) => partes[0] === f);
  if (!fonte) return null;
  const ultima = partes[partes.length - 1] ?? "";
  const slug = ultima && ultima !== fonte && ultima !== "powered-by" ? ultima : "";
  return slug ? `${fonte}:${slug}` : fonte;
}

/**
 * Classifica um lead da EMPRESA-PLATAFORMA — quem quer CONTRATAR o sistema —
 * pelo caminho de entrada.
 *
 * O canal que mais interessa é o boca a boca do próprio produto: a lojista
 * que descobre o AtacadoPro no rodapé do catálogo (ou da bio) de outra loja.
 * `landingSource` guarda essa marca ("catalogo:<slug>", "bio:<slug>"), posta
 * pelo formulário do site a partir do utm do link.
 */
export function canalDoLead(lead: {
  origin: string;
  landingSource: string | null;
}): CanalDeLead {
  if (lead.landingSource?.startsWith("bio")) return "BIO";
  if (lead.landingSource?.startsWith("catalogo")) return "CATALOGO_DE_LOJA";
  if (lead.origin === "SITE") return "LANDING";
  if (lead.origin === "CATALOGO_PUBLICO") return "CATALOGO_PLATAFORMA";
  return "OUTROS";
}
