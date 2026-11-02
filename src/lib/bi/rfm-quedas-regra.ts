/**
 * AS QUEDAS DO RFM — a regra pura (RN-100, Etapa 3 do RFM).
 *
 * Decidido com o dono (22/10/2026): quando a cliente CAI de grupo, a
 * vendedora dona dela recebe uma TAREFA. A gerência vê o RFM; a vendedora
 * recebe o trabalho.
 *
 * "Caiu" tem régua, senão a tarefa vira barulho (as notas são relativas à
 * loja e mexem todo dia, RN-093):
 *  - a ordem dos grupos é a da tela, do melhor para o mais distante
 *    (`GRUPOS_RFM`) — uma ordem só, nunca duas;
 *  - só vira tarefa a queda que ENTRA num grupo de alerta (Precisam de
 *    atenção, Não posso perder, Hibernando, Perdidas). Campeã que vira Fiel
 *    continua comprando — é movimento, não alarme (o retrato do mês mostra);
 *  - só cliente com DONA ativa na carteira ganha tarefa (a da loja, sem dona,
 *    fica no RFM da gerência); a queda dela ESPERA, e nasce a tarefa quando
 *    a gerência a der a uma vendedora;
 *  - no máximo `TETO_POR_DONA` tarefas NOVAS por vendedora por rodada (a
 *    atualização de uma tarefa aberta não conta): quem espera há mais tempo
 *    primeiro, depois as de maior LTV. As que passaram do teto NÃO são
 *    esquecidas: a memória delas fica com o grupo antigo, marcada com
 *    `seguradaDesde`, e na rodada seguinte elas vão na frente — a fila anda.
 *
 * A primeira vez que a cliente aparece não é queda: é o ponto de partida
 * (ligar a chave do BI numa loja com 800 clientes não pode criar 800
 * tarefas) — e o mesmo depois de muito tempo sem rodada.
 */
import { GRUPOS_RFM, type GrupoRfm } from "./rfm-regra";

/** o grupo de alerta: a tarefa existe para trazer a cliente de volta */
export const GRUPOS_DE_ALERTA: ReadonlySet<GrupoRfm> = new Set<GrupoRfm>(["ATENCAO", "NAO_PERDER", "HIBERNANDO", "PERDIDAS"]);

/** tarefas novas por vendedora por rodada (uma rodada por dia) */
export const TETO_POR_DONA = 10;

const posicao = (g: GrupoRfm) => GRUPOS_RFM.findIndex((x) => x.id === g);

/** A cliente caiu de `antes` para `agora` de um jeito que pede tarefa? */
export function caiuParaAlerta(antes: GrupoRfm, agora: GrupoRfm): boolean {
  return GRUPOS_DE_ALERTA.has(agora) && posicao(agora) > posicao(antes);
}

export type ClienteDaRodada = {
  id: string;
  grupo: GrupoRfm;
  ltv: number;
  /** a dona ATIVA da carteira (id), ou null */
  donaId: string | null;
};

/** a memória de uma cliente: o grupo da última rodada e desde quando a queda dela espera a vez */
export type Lembranca = { grupo: GrupoRfm; seguradaDesde: Date | null };

export type Queda = { customerId: string; de: GrupoRfm; para: GrupoRfm; donaId: string };
export type QuedaDaRodada = Queda & {
  /** a cliente já tinha tarefa de queda aberta: é ATUALIZAÇÃO, fora do teto */
  atualizar: boolean;
};

export type DecisaoDasQuedas = {
  /** quedas que viram tarefa (nova ou atualizada) NESTA rodada */
  tarefas: QuedaDaRodada[];
  /** a memória a gravar: quem entrou num grupo agora (ou apareceu pela primeira vez) */
  gravar: { customerId: string; grupo: GrupoRfm }[];
  /** quedas que esperam a vez (o teto, ou a cliente sem dona): a memória fica como está */
  seguradas: { customerId: string; para: GrupoRfm; donaId: string | null }[];
  /** memória de quem não está mais no RFM (a venda foi cancelada) */
  apagar: string[];
};

export type OpcoesDaDecisao = {
  teto?: number;
  /** clientes que já têm tarefa de queda ABERTA (cair de novo atualiza a mesma) */
  comTarefaAberta?: ReadonlySet<string>;
  /**
   * Ponto de partida: grava a memória de todas e NÃO cria tarefa. Vale na
   * primeira rodada e depois de muito tempo sem rodada (a chave do BI
   * desligada e religada) — comparar com uma memória de meses transformaria
   * meses de quedas em tarefas "de hoje".
   */
  partida?: boolean;
};

/** Função PURA: memória da rodada anterior × grupos de agora → o que fazer. */
export function decidirQuedas(
  anteriores: ReadonlyMap<string, Lembranca>,
  atuais: ClienteDaRodada[],
  { teto = TETO_POR_DONA, comTarefaAberta = new Set(), partida = false }: OpcoesDaDecisao = {}
): DecisaoDasQuedas {
  const gravar: DecisaoDasQuedas["gravar"] = [];
  const tarefas: QuedaDaRodada[] = [];
  const seguradas: DecisaoDasQuedas["seguradas"] = [];
  const candidatas: (Queda & { ltv: number; esperaDesde: number })[] = [];
  const presentes = new Set<string>();

  for (const c of atuais) {
    presentes.add(c.id);
    const antes = anteriores.get(c.id);
    if (partida || antes === undefined) {
      // ponto de partida, nunca queda
      if (antes?.grupo !== c.grupo || antes?.seguradaDesde) gravar.push({ customerId: c.id, grupo: c.grupo });
      continue;
    }
    if (antes.grupo === c.grupo) continue;
    if (!caiuParaAlerta(antes.grupo, c.grupo)) {
      gravar.push({ customerId: c.id, grupo: c.grupo });
      continue;
    }
    if (!c.donaId) {
      // sem dona a queda ESPERA (a memória não anda): se a gerência der a
      // cliente a uma vendedora, a tarefa nasce para ela na rodada seguinte
      seguradas.push({ customerId: c.id, para: c.grupo, donaId: null });
      continue;
    }
    const q: Queda = { customerId: c.id, de: antes.grupo, para: c.grupo, donaId: c.donaId };
    if (comTarefaAberta.has(c.id)) {
      // atualização da tarefa que já existe: não é tarefa NOVA, não conta no teto
      tarefas.push({ ...q, atualizar: true });
      gravar.push({ customerId: c.id, grupo: c.grupo });
      continue;
    }
    candidatas.push({ ...q, ltv: c.ltv, esperaDesde: antes.seguradaDesde?.getTime() ?? Infinity });
  }

  // o teto por vendedora: quem ESPERA há mais tempo primeiro (a fila anda —
  // sem isso a cliente de pouco valor perdia a vez para sempre), depois a de
  // maior valor; empate pelo id, para a ordem não depender da leitura
  candidatas.sort(
    (a, b) => a.esperaDesde - b.esperaDesde || b.ltv - a.ltv || (a.customerId < b.customerId ? -1 : 1)
  );
  const porDona = new Map<string, number>();
  for (const { ltv: _ltv, esperaDesde: _espera, ...q } of candidatas) {
    const n = porDona.get(q.donaId) ?? 0;
    if (n < teto) {
      porDona.set(q.donaId, n + 1);
      tarefas.push({ ...q, atualizar: false });
      gravar.push({ customerId: q.customerId, grupo: q.para });
    } else {
      seguradas.push({ customerId: q.customerId, para: q.para, donaId: q.donaId });
    }
  }

  const apagar = [...anteriores.keys()].filter((id) => !presentes.has(id));
  return { tarefas, gravar, seguradas, apagar };
}

/** O texto da tarefa (puro): título, motivo e a ação do grupo. */
export function textoDaQueda(
  q: { de: GrupoRfm; para: GrupoRfm },
  cliente: { nome: string; diasDesde: number; compras12: number; valor12: number },
  brl: (v: number) => string
): { titulo: string; descricao: string } {
  const de = GRUPOS_RFM.find((g) => g.id === q.de)!;
  const para = GRUPOS_RFM.find((g) => g.id === q.para)!;
  const compras =
    cliente.compras12 === 0
      ? "nenhuma compra nos últimos 12 meses"
      : `${cliente.compras12} compra${cliente.compras12 === 1 ? "" : "s"} e ${brl(cliente.valor12)} nos últimos 12 meses`;
  return {
    titulo: `${para.emoji} ${cliente.nome} caiu para ${para.rotulo}`,
    descricao: `No RFM ela era ${de.emoji} ${de.rotulo} e agora é ${para.emoji} ${para.rotulo}: última compra há ${cliente.diasDesde} dia${cliente.diasDesde === 1 ? "" : "s"}, ${compras}. Ação sugerida: ${para.acao}. O "Conversar" abre a conversa com a mensagem do grupo pronta.`,
  };
}

/** prioridade e tipo da tarefa por grupo: "Não posso perder" é o alarme mais alto */
export function prioridadeDaQueda(para: GrupoRfm): { priority: "ALTA" | "MEDIA" | "BAIXA"; type: "FOLLOW_UP" | "REATIVAR" } {
  switch (para) {
    case "NAO_PERDER":
      return { priority: "ALTA", type: "REATIVAR" };
    case "ATENCAO":
      return { priority: "MEDIA", type: "FOLLOW_UP" };
    case "HIBERNANDO":
      return { priority: "MEDIA", type: "REATIVAR" };
    default:
      return { priority: "BAIXA", type: "REATIVAR" };
  }
}

/** a chave da tarefa automática: `rfm-queda:<grupo>:<cliente>` (o grupo é o que a Agenda usa para a mensagem) */
export const PREFIXO_DA_QUEDA = "rfm-queda:";
export const chaveDaQueda = (para: GrupoRfm, customerId: string) => `${PREFIXO_DA_QUEDA}${para}:${customerId}`;

/** O grupo de uma chave de tarefa de queda, ou null. */
export function grupoDaChave(autoRule: string | null | undefined): GrupoRfm | null {
  if (!autoRule?.startsWith(PREFIXO_DA_QUEDA)) return null;
  const g = autoRule.slice(PREFIXO_DA_QUEDA.length).split(":")[0];
  return GRUPOS_RFM.some((x) => x.id === g) ? (g as GrupoRfm) : null;
}
