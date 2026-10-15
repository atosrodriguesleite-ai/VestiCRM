import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { paginaSegura, quebrarEmLinhas, textoPdf } from "../pdf-texto";
import { brl, originLabel } from "../format";
import { TIPOS_DE_META, progressoDaMeta } from "./metas";
import { diasDoPeriodo, variacao, type Painel, type Vendedoras } from "./painel";
import { ROTULO_DO_BALDE } from "./fatos";
import type { MesDaTendencia } from "./tendencia";
import { COR_DA_SERIE, RAMPA_ORDINAL, conversaoDoFunil } from "./paleta";
import type { Origin } from "@prisma/client";

/**
 * O RELATÓRIO DO BI EM PDF (RN-090): o período que está na tela, em papel —
 * para a reunião com a assessoria, para o grupo do WhatsApp da gerência, para
 * guardar o mês. A quinta recomendação aceita pelo dono.
 *
 * Duas camadas, de propósito: `secoesDoRelatorio` monta o CONTEÚDO (puro,
 * testável sem abrir PDF: cada número, cada frase, cada linha de tabela) a
 * partir dos MESMOS objetos que a tela lê (`montarPainel`, `montarVendedoras`,
 * `montarTendencia`) — o papel nunca diz um número diferente da tela, porque
 * não faz conta própria; e `gerarPdfDoRelatorio` só DESENHA esse conteúdo
 * com o pdf-lib (a mesma peça do extrato de comissão e das etiquetas, sem
 * navegador — roda na função da Vercel). Texto passa por `paginaSegura`: o
 * emoji do motivo de perda não derruba o PDF (lição do romaneio).
 */

export type DadosDoRelatorio = {
  loja: string;
  geradoPor: string;
  geradoEm: Date;
  /** prazo do 1º atendimento (minutos de atendimento) */
  prazoMin: number;
  semHorario: boolean;
  painel: Painel;
  vendedoras: Vendedoras;
  tendencia: MesDaTendencia[];
};

export type Bloco =
  | { tipo: "numeros"; itens: { rotulo: string; valor: string; delta?: string; nota?: string }[] }
  | { tipo: "barras"; itens: { rotulo: string; valor: number; texto: string }[]; rampa?: boolean }
  | { tipo: "serie"; pontos: number[]; rotulos: string[]; formato: "int" | "brl" }
  | { tipo: "tabela"; colunas: string[]; linhas: string[][]; rodape?: string[] }
  | { tipo: "texto"; linhas: string[] };

export type Secao = { titulo: string; nota?: string; blocos: Bloco[] };

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v}%`);
const int = (v: number | null | undefined) => (v == null ? "—" : String(v));
const dinheiro = (v: number | null | undefined) => (v == null ? "—" : brl(v).replace(/ /g, " "));

/** "dd/mm/aaaa" de um dia "aaaa-mm-dd" (puro — o dia já é o de SP) */
export function diaBR(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
}

/**
 * "+12% vs. período anterior" / "-3 pontos vs. período anterior" / "sem base de comparação".
 * O sinal de menos é o HÍFEN ASCII de propósito: o "−" tipográfico (U+2212) não
 * existe na WinAnsi e o `paginaSegura` o apagaria — o papel diria "+" onde a
 * tela diz "−" (achado da revisão).
 */
export function textoDaVariacao(v: number | null, unidade: "pct" | "pontos" = "pct"): string {
  if (v == null) return "sem base de comparação";
  const sinal = v > 0 ? "+" : v < 0 ? "-" : "";
  const n = Math.abs(Math.round(v));
  return unidade === "pontos" ? `${sinal}${n} ponto${n === 1 ? "" : "s"} vs. período anterior` : `${sinal}${n}% vs. período anterior`;
}

function mediana(min: number | null): string {
  if (min == null) return "—";
  if (min === Infinity) return "mais de 4 h";
  return `${min} min`;
}

/** O conteúdo do relatório — puro, a partir do que a tela já lê. */
export function secoesDoRelatorio(d: DadosDoRelatorio): Secao[] {
  const { painel, vendedoras, tendencia } = d;
  const { atual, passado, funil, serie } = painel;
  const dias = diasDoPeriodo(painel.periodo).length;
  const secoes: Secao[] = [];

  secoes.push({
    titulo: "Os números do período",
    nota: `${dias} dias, comparados com os ${dias} dias anteriores (${diaBR(painel.anterior.de)} a ${diaBR(painel.anterior.ate)}).`,
    blocos: [
      {
        tipo: "numeros",
        itens: [
          { rotulo: "Novos contatos", valor: int(atual.leads), delta: textoDaVariacao(variacao(atual.leads, passado.leads)), nota: `${Object.keys(atual.origens).length} origens` },
          {
            rotulo: "Respondidos no prazo",
            valor: pct(atual.pctNoPrazo),
            delta: atual.pctNoPrazo != null && passado.pctNoPrazo != null ? textoDaVariacao(atual.pctNoPrazo - passado.pctNoPrazo, "pontos") : textoDaVariacao(null),
            nota: atual.esperas ? `${atual.respondidas} respondidas · metade em até ${mediana(atual.medianaAproxMin)} · prazo de ${d.prazoMin} min` : "nenhuma espera no período",
          },
          { rotulo: "Sem resposta", valor: int(atual.semResposta), nota: "clientes que escreveram e ninguém da loja respondeu" },
          { rotulo: "Vendido no período", valor: dinheiro(atual.vendido), delta: textoDaVariacao(variacao(atual.vendido, passado.vendido)), nota: `${atual.pedidosPagos} pedidos pagos, sem o frete` },
          { rotulo: "Ticket médio", valor: dinheiro(atual.ticket), delta: atual.ticket != null && passado.ticket != null ? textoDaVariacao(variacao(atual.ticket, passado.ticket)) : textoDaVariacao(null), nota: "valor vendido ÷ pedidos pagos" },
          { rotulo: "Taxa de recompra", valor: pct(painel.recompraPct), nota: "clientes com 2+ compras pagas, entre quem já comprou (histórico)" },
        ],
      },
    ],
  });

  const comMeta = TIPOS_DE_META.filter((t) => painel.metas[t.tipo] != null);
  if (comMeta.length) {
    const rotuloDoMes = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${painel.mes}-15T12:00:00Z`));
    secoes.push({
      titulo: `Metas de ${rotuloDoMes}`,
      nota: "Realizado no mês até agora × a meta que a loja definiu.",
      blocos: [
        {
          tipo: "tabela",
          colunas: ["Meta", "Realizado", "Meta", "Atingido"],
          linhas: comMeta.map((t) => {
            const meta = painel.metas[t.tipo]!;
            const real = painel.realizado[t.tipo];
            const fmt = t.formato === "brl" ? dinheiro : t.formato === "pct" ? pct : int;
            return [t.rotulo, fmt(real), fmt(meta), pct(progressoDaMeta(real, meta))];
          }),
        },
      ],
    });
  }

  const etapas = [
    { label: "Contatos novos", value: funil.leads },
    { label: "Respondidos por uma pessoa", value: funil.respondidos },
    { label: "Fizeram pedido", value: funil.comPedido },
    { label: "Pagaram", value: funil.pagaram },
  ];
  const conv = conversaoDoFunil(etapas);
  secoes.push({
    titulo: "Funil por fatos",
    nota: "Dos contatos novos do período: quantos receberam resposta de uma pessoa, fizeram pedido e pagaram, até 7 dias depois do cadastro.",
    blocos: [
      funil.leads === 0
        ? { tipo: "texto", linhas: ["Nenhum contato novo no período."] }
        : {
            tipo: "barras",
            rampa: true,
            itens: etapas.map((e, i) => ({
              rotulo: e.label,
              valor: e.value,
              texto: `${e.value}${conv[i].daAnterior != null ? ` · ${conv[i].daAnterior}% da anterior` : ""}${conv[i].daPrimeira != null ? ` · ${conv[i].daPrimeira}% do começo` : ""}`,
            })),
          },
    ],
  });

  const rotulosDaSerie = serie.map((s) => `${s.dia.slice(8, 10)}/${s.dia.slice(5, 7)}`);
  secoes.push({
    titulo: "Novos contatos por dia",
    blocos: [{ tipo: "serie", pontos: serie.map((s) => s.leads), rotulos: rotulosDaSerie, formato: "int" }],
  });
  secoes.push({
    titulo: "Vendido por dia",
    nota: "Pela data do pagamento, valor vendido sem o frete.",
    blocos: [{ tipo: "serie", pontos: serie.map((s) => s.vendido), rotulos: rotulosDaSerie, formato: "brl" }],
  });

  const totalRespondidas = atual.hist.reduce((a, b) => a + b, 0);
  secoes.push({
    titulo: "Quanto a cliente esperou",
    nota: `Distribuição das ${totalRespondidas} respostas do período, em minutos com a loja aberta.`,
    blocos: [
      totalRespondidas === 0
        ? { tipo: "texto", linhas: ["Sem respostas no período."] }
        : {
            tipo: "barras",
            itens: atual.hist.map((n, i) => ({ rotulo: ROTULO_DO_BALDE[i] ?? ROTULO_DO_BALDE[ROTULO_DO_BALDE.length - 1], valor: n, texto: `${n} (${Math.round((n / totalRespondidas) * 100)}%)` })),
          },
    ],
  });

  const origens = Object.entries(atual.origens)
    .map(([k, v]) => ({ rotulo: originLabel[k as Origin] ?? k, valor: v, texto: String(v) }))
    .sort((a, b) => b.valor - a.valor);
  secoes.push({
    titulo: "De onde vieram",
    nota: "Origem dos contatos novos do período.",
    blocos: [origens.length ? { tipo: "barras", itens: origens } : { tipo: "texto", linhas: ["Nenhum contato novo."] }],
  });

  secoes.push({
    titulo: "Por que não fechou",
    nota: "Negociações perdidas no período, pelo motivo escolhido no funil.",
    blocos: [
      painel.motivos.length
        ? { tipo: "barras", itens: painel.motivos.map((m) => ({ rotulo: m.sub ? `${m.label} (${m.sub})` : m.label, valor: m.value, texto: String(m.value) })) }
        : { tipo: "texto", linhas: ["Nenhuma negociação perdida."] },
    ],
  });

  const linhaDaPessoa = (p: Vendedoras["pessoas"][number]) => [
    p.ativa ? p.nome : `${p.nome} (desativada)`,
    int(p.leads),
    int(p.leadsPagaram),
    int(p.respondidas),
    pct(p.pctNoPrazo),
    int(p.semResposta),
    int(p.pedidosPagos),
    dinheiro(p.vendido),
    pct(p.conversaoPct),
  ];
  const sv = vendedoras.semVendedora;
  const loja = vendedoras.loja;
  // a MESMA régua de "tem número" da aba Vendedoras (`temNumeroNaLoja`): o papel não pode dizer
  // "nenhum número" num período em que a aba mostra a fila com 5 sem resposta
  const temNumeroNaLoja = loja.leads + loja.respondidas + loja.semResposta + loja.pedidos + loja.pedidosPagos > 0;
  const blocosDaVendedora: Bloco[] = [];
  if (vendedoras.pessoas.length === 0) {
    blocosDaVendedora.push({
      tipo: "texto",
      linhas: [
        temNumeroNaLoja
          ? "Nenhum número com vendedora no período: a loja teve movimento, mas nada com dona (respostas pelo celular da loja, leads da loja, vendas da loja online, fila)."
          : "Nenhum número no período.",
      ],
    });
  }
  secoes.push({
    titulo: "Por vendedora",
    nota:
      "A espera respondida é de quem respondeu; o contato novo é da dona da carteira; o pedido é da vendedora dele. " +
      "O que não tem dona (celular da loja, fila, loja online) fica em \"Sem vendedora\"." +
      (vendedoras.diasSemVendedoras > 0 ? ` ${vendedoras.diasSemVendedoras} dia(s) do período ainda sem a conta por pessoa.` : ""),
    blocos: [
      ...blocosDaVendedora,
      ...(vendedoras.pessoas.length === 0 && !temNumeroNaLoja
        ? []
        : [{
            tipo: "tabela",
            colunas: ["Vendedora", "Contatos", "Pagaram", "Respondeu", "No prazo", "Sem resp.", "Pedidos", "Vendido", "Converteu"],
            linhas: [
              ...vendedoras.pessoas.map(linhaDaPessoa),
              ["Sem vendedora", int(sv.leads), "—", int(sv.respondidas), "—", int(sv.semResposta), int(sv.pedidosPagos), dinheiro(sv.vendido), "—"],
            ],
            rodape: ["Loja inteira", int(loja.leads), int(loja.leadsPagaram), int(loja.respondidas), pct(loja.pctNoPrazo), int(loja.semResposta), int(loja.pedidosPagos), dinheiro(loja.vendido), "—"],
          } satisfies Bloco]),
    ],
  });

  // as mesmas ressalvas do cartão da tendência: o mês coberto pela metade diz "N de M dias", e a
  // legenda diz de onde o atendimento passou a ser contado (sem isso 75% de setembro parecia o mês inteiro)
  const primeiroComFato = tendencia.find((m) => m.diasComFato > 0);
  secoes.push({
    titulo: "Últimos 12 meses",
    nota:
      "Mês a mês, independente do período escolhido. Contatos e vendas são da história inteira; o atendimento só desde que há fatos" +
      (primeiroComFato ? ` — contado a partir de ${primeiroComFato.rotulo}` : "") +
      ". Mês sem fato de atendimento fica com traço.",
    blocos: [
      {
        tipo: "tabela",
        colunas: ["Mês", "Contatos", "No prazo", "Sem resp.", "Pedidos pagos", "Vendido", "Ticket"],
        linhas: tendencia.map((m) => {
          const parcial = m.diasComFato > 0 && m.diasComFato < m.diasNoMes;
          return [
            m.rotulo,
            int(m.leads),
            m.pctNoPrazo == null ? "—" : parcial ? `${m.pctNoPrazo}% (${m.diasComFato} de ${m.diasNoMes} dias)` : pct(m.pctNoPrazo),
            m.semResposta == null ? "—" : int(m.semResposta),
            int(m.pedidosPagos),
            dinheiro(m.vendido),
            dinheiro(m.ticket),
          ];
        }),
      },
    ],
  });

  const avisos: string[] = ["Mensagem automática nunca conta como resposta; o tempo é contado só com a loja aberta (horário de atendimento)."];
  if (d.semHorario) avisos.push("Sem horário de atendimento cadastrado: o tempo de resposta está contando o dia inteiro, madrugada inclusa.");
  if (painel.diasSemFato > 0) avisos.push(`${painel.diasSemFato} dia(s) do período ainda sem fatos gravados — o histórico está sendo preenchido aos poucos.`);
  secoes.push({ titulo: "Como ler", blocos: [{ tipo: "texto", linhas: avisos }] });

  return secoes;
}

// ---------------------------------------------------------------- desenho

const INK = rgb(0.118, 0.161, 0.235);
const GRAY = rgb(0.392, 0.455, 0.545);
const LIGHT = rgb(0.945, 0.961, 0.976);
const LINE = rgb(0.89, 0.91, 0.94);
const hex = (h: string): RGB => {
  const n = parseInt(h.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const COBRE = hex(COR_DA_SERIE);
const RAMPA = RAMPA_ORDINAL.map(hex);

const A4: [number, number] = [595.28, 841.89];
const M = 40;

type Cursor = { page: PDFPage; y: number; pages: PDFPage[] };

/** o papel: cursor que desce e abre página nova quando a altura pedida não cabe */
function papel(pdf: PDFDocument): Cursor & { garantir: (h: number) => void } {
  const nova = () => paginaSegura(pdf.addPage(A4));
  const c: Cursor & { garantir: (h: number) => void } = {
    page: nova(),
    y: A4[1] - M,
    pages: [],
    garantir(h: number) {
      if (this.y - h < M + 24) {
        this.page = nova();
        this.pages.push(this.page);
        this.y = A4[1] - M;
      }
    },
  };
  c.pages.push(c.page);
  return c;
}

export async function gerarPdfDoRelatorio(d: DadosDoRelatorio): Promise<Uint8Array> {
  const secoes = secoesDoRelatorio(d);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`BI de Vendas — ${d.loja}`);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const c = papel(pdf);
  const W = A4[0] - 2 * M;
  // mede o texto JÁ filtrado: medir o cru com um emoji no nome de quem gerou estourava a fonte (achado da revisão)
  const medir = (t: string, f: PDFFont, size: number) => f.widthOfTextAtSize(textoPdf(t), size);
  /** o texto que CABE na largura: encolhe até 80% e só então corta com "…" */
  const caber = (t: string, f: PDFFont, size: number, largura: number): { t: string; size: number } => {
    if (medir(t, f, size) <= largura) return { t, size };
    const menor = size * 0.8;
    if (medir(t, f, menor) <= largura) return { t, size: menor };
    return { t: quebrarEmLinhas(t, (x) => medir(x, f, menor), largura, 1)[0], size: menor };
  };
  const texto = (t: string, x: number, y: number, o: { size?: number; font?: PDFFont; color?: RGB; direita?: number } = {}) => {
    const size = o.size ?? 9;
    const f = o.font ?? font;
    const x0 = o.direita != null ? o.direita - medir(t, f, size) : x;
    c.page.drawText(t, { x: x0, y, size, font: f, color: o.color ?? INK });
  };
  const paragrafo = (t: string, x: number, largura: number, o: { size?: number; color?: RGB; maxLinhas?: number } = {}) => {
    const size = o.size ?? 8.5;
    const linhas = quebrarEmLinhas(t, (s) => medir(s, font, size), largura, o.maxLinhas ?? 6);
    for (const l of linhas) {
      c.garantir(size + 4);
      texto(l, x, c.y - size, { size, color: o.color ?? GRAY });
      c.y -= size + 3;
    }
  };

  // cabeçalho
  const { painel } = d;
  const dias = diasDoPeriodo(painel.periodo).length;
  c.page.drawRectangle({ x: 0, y: A4[1] - 78, width: A4[0], height: 78, color: hex("#3a2a1e") });
  c.page.drawText("BI de Vendas", { x: M, y: A4[1] - 34, size: 18, font: bold, color: rgb(1, 1, 1) });
  c.page.drawText(d.loja, { x: M, y: A4[1] - 52, size: 11, font, color: hex("#ebcdb2") });
  texto(`Período: ${diaBR(painel.periodo.de)} a ${diaBR(painel.periodo.ate)} (${dias} dias)`, M, A4[1] - 68, { size: 9, color: rgb(1, 1, 1) });
  const geradoEm = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(d.geradoEm);
  texto(`Gerado em ${geradoEm} por ${d.geradoPor}`, 0, A4[1] - 68, { size: 8, color: hex("#ebcdb2"), direita: A4[0] - M });
  c.y = A4[1] - 78 - 22;

  /** a altura aproximada do primeiro bloco: o título nunca fica órfão no pé da página */
  const alturaDoBloco = (b: Bloco): number => {
    if (b.tipo === "numeros") return Math.ceil(b.itens.length / 3) * 74;
    if (b.tipo === "barras") return b.itens.length * 16 + 4;
    if (b.tipo === "serie") return 134;
    if (b.tipo === "tabela") return 14 * 3;
    return 12 * b.linhas.length;
  };
  const titulo = (s: Secao) => {
    c.garantir(40 + Math.min(alturaDoBloco(s.blocos[0]), 160));
    texto(s.titulo, M, c.y - 11, { size: 12, font: bold });
    c.y -= 17;
    if (s.nota) paragrafo(s.nota, M, W);
    c.y -= 4;
  };

  const desenharNumeros = (b: Extract<Bloco, { tipo: "numeros" }>) => {
    const col = 3;
    const gw = (W - (col - 1) * 10) / col;
    const gh = 66;
    for (let i = 0; i < b.itens.length; i += col) {
      c.garantir(gh + 8);
      const linha = b.itens.slice(i, i + col);
      linha.forEach((it, j) => {
        const x = M + j * (gw + 10);
        const y0 = c.y - gh;
        c.page.drawRectangle({ x, y: y0, width: gw, height: gh, color: LIGHT, borderColor: LINE, borderWidth: 0.5 });
        texto(it.rotulo, x + 10, y0 + gh - 15, { size: 8, color: GRAY });
        texto(it.valor, x + 10, y0 + gh - 33, { size: 15, font: bold });
        if (it.delta) texto(it.delta, x + 10, y0 + 22, { size: 7, color: it.delta.startsWith("+") ? hex("#047857") : it.delta.startsWith("-") ? hex("#b91c1c") : GRAY });
        if (it.nota) {
          // a nota tem DUAS linhas (uma só cortava "metade em até 15 min · prazo…")
          quebrarEmLinhas(it.nota, (s) => medir(s, font, 6.5), gw - 20, 2).forEach((l, k) => texto(l, x + 10, y0 + 13 - k * 8, { size: 6.5, color: GRAY }));
        }
      });
      c.y -= gh + 8;
    }
  };

  const desenharBarras = (b: Extract<Bloco, { tipo: "barras" }>) => {
    const max = Math.max(...b.itens.map((i) => i.valor), 1);
    const lx = M;
    const lw = 130;
    const bx = M + lw + 8;
    // o texto da ponta é MEDIDO: "1200 · 100% da anterior · 100% do começo" passava da margem
    const slot = Math.max(60, ...b.itens.map((i) => medir(i.texto, bold, 8))) + 6;
    const bw = Math.max(60, W - lw - 8 - slot);
    b.itens.forEach((it, i) => {
      c.garantir(16);
      const y0 = c.y - 12;
      const rotulo = quebrarEmLinhas(it.rotulo, (s) => medir(s, font, 8), lw - 4, 1)[0];
      texto(rotulo, lx, y0 + 2, { size: 8, color: GRAY });
      c.page.drawRectangle({ x: bx, y: y0, width: bw, height: 10, color: LIGHT });
      const w = Math.max((it.valor / max) * bw, it.valor > 0 ? 2 : 0);
      if (w > 0) c.page.drawRectangle({ x: bx, y: y0, width: w, height: 10, color: b.rampa ? RAMPA[Math.min(i, RAMPA.length - 1)] : COBRE });
      texto(it.texto, bx + bw + 6, y0 + 2, { size: 8, font: bold });
      c.y -= 16;
    });
    c.y -= 4;
  };

  const desenharSerie = (b: Extract<Bloco, { tipo: "serie" }>) => {
    const h = 110;
    c.garantir(h + 24);
    const n = b.pontos.length;
    const fmt = (v: number) => (b.formato === "brl" ? dinheiro(v) : String(v));
    const maior = n ? Math.max(...b.pontos) : 0;
    const max = Math.max(maior, 1);
    const px = M + 4;
    const pw = W - 8;
    // o resumo fica ACIMA da área (o pico no fim do mês caía em cima dele)
    if (n > 0) texto(`total ${fmt(b.pontos.reduce((a, v) => a + v, 0))} · maior dia ${fmt(maior)}`, 0, c.y - 8, { size: 7, color: GRAY, direita: px + pw });
    const top = c.y - 20;
    const bottom = c.y - h + 14;
    const ih = top - bottom;
    [0, 0.5, 1].forEach((f) => c.page.drawLine({ start: { x: px, y: bottom + ih * f }, end: { x: px + pw, y: bottom + ih * f }, thickness: 0.5, color: LINE }));
    if (n === 0) {
      texto("Sem dados no período.", px, bottom + ih / 2, { size: 8, color: GRAY });
    } else {
      const step = n > 1 ? pw / (n - 1) : 0;
      const xy = b.pontos.map((v, i) => ({ x: px + i * step, y: bottom + (v / max) * ih }));
      for (let i = 1; i < n; i++) c.page.drawLine({ start: xy[i - 1], end: xy[i], thickness: 1.5, color: COBRE });
      const maxIdx = b.pontos.indexOf(maior);
      c.page.drawCircle({ x: xy[maxIdx].x, y: xy[maxIdx].y, size: 2.5, color: COBRE });
      if (maior > 0) {
        const t = fmt(maior);
        const tw = medir(t, bold, 7.5);
        texto(t, Math.min(Math.max(xy[maxIdx].x - tw / 2, px), px + pw - tw), Math.min(xy[maxIdx].y + 5, top + 2), { size: 7.5, font: bold });
      }
      // eixo: até 6 rótulos e sempre o último
      const cada = Math.max(1, Math.ceil(n / 6));
      const eixo = b.rotulos.map((_, i) => i).filter((i) => i % cada === 0 || i === n - 1);
      const ultimo = eixo[eixo.length - 1];
      const vizinho = eixo[eixo.length - 2];
      const visiveis = vizinho != null && (ultimo - vizinho) * step < 26 ? eixo.filter((i) => i !== vizinho) : eixo;
      visiveis.forEach((i) => {
        const t = b.rotulos[i];
        const tw = medir(t, font, 7);
        const x = i === 0 ? px : i === n - 1 ? px + pw - tw : xy[i].x - tw / 2;
        texto(t, x, bottom - 10, { size: 7, color: GRAY });
      });
    }
    c.y -= h + 10;
  };

  const desenharTabela = (b: Extract<Bloco, { tipo: "tabela" }>) => {
    const size = 7.5;
    const todas = [b.colunas, ...b.linhas, ...(b.rodape ? [b.rodape] : [])];
    // cada coluna de número tem a largura do MAIOR valor dela (+ folga); o nome fica com o resto, no mínimo 70
    let larguras = b.colunas.map((_, i) => (i === 0 ? 0 : Math.max(...todas.map((l) => medir(l[i] ?? "", bold, size))) + 10));
    const somaDosNumeros = larguras.reduce((a, w) => a + w, 0);
    const minimoDoNome = 70;
    if (somaDosNumeros + minimoDoNome > W) {
      const fator = (W - minimoDoNome) / somaDosNumeros;
      larguras = larguras.map((w, i) => (i === 0 ? 0 : w * fator));
    }
    larguras[0] = W - larguras.reduce((a, w) => a + w, 0);
    const xs = larguras.reduce<number[]>((acc, _, i) => [...acc, i === 0 ? M : acc[i - 1] + larguras[i - 1]], []);
    const desenharLinha = (cells: string[], o: { fundo?: RGB; font?: PDFFont }) => {
      const y0 = c.y - 13;
      if (o.fundo) c.page.drawRectangle({ x: M, y: y0, width: W, height: 13, color: o.fundo });
      cells.forEach((t, i) => {
        const f = o.font ?? font;
        const { t: tt, size: sz } = caber(t, f, size, larguras[i] - 8);
        if (i === 0) texto(tt, xs[i] + 4, y0 + 4, { size: sz, font: f });
        else texto(tt, 0, y0 + 4, { size: sz, font: f, direita: xs[i] + larguras[i] - 4 });
      });
      c.y -= 13;
    };
    const cabecalho = () => desenharLinha(b.colunas, { fundo: LIGHT, font: bold });
    // a linha que abre página nova leva o cabeçalho junto: coluna sem nome não se lê
    const linha = (cells: string[], o: { fundo?: RGB; font?: PDFFont }) => {
      const antes = c.page;
      c.garantir(14);
      if (c.page !== antes) cabecalho();
      desenharLinha(cells, o);
    };
    c.garantir(14 * 2);
    cabecalho();
    b.linhas.forEach((l, i) => linha(l, { fundo: i % 2 ? LIGHT : undefined }));
    if (b.rodape) linha(b.rodape, { font: bold });
    c.page.drawLine({ start: { x: M, y: c.y }, end: { x: M + W, y: c.y }, thickness: 0.5, color: LINE });
    c.y -= 8;
  };

  for (const s of secoes) {
    titulo(s);
    for (const b of s.blocos) {
      if (b.tipo === "numeros") desenharNumeros(b);
      else if (b.tipo === "barras") desenharBarras(b);
      else if (b.tipo === "serie") desenharSerie(b);
      else if (b.tipo === "tabela") desenharTabela(b);
      else b.linhas.forEach((l) => paragrafo(`• ${l}`, M, W));
    }
    c.y -= 6;
  }

  const rodape = `BI de Vendas · ${d.loja} · ${diaBR(painel.periodo.de)} a ${diaBR(painel.periodo.ate)} · gerado por ${d.geradoPor}`;
  c.pages.forEach((pg, i) => {
    pg.drawText(`${rodape}${c.pages.length > 1 ? ` · pág. ${i + 1}/${c.pages.length}` : ""}`, { x: M, y: 24, size: 7, font, color: GRAY });
  });
  return pdf.save();
}

/** o nome do arquivo baixado: bi-<loja>-<de>-<ate>.pdf, só com letra, número e hífen */
export function nomeDoArquivo(loja: string, periodo: { de: string; ate: string }): string {
  const slug = loja
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `bi-${slug || "loja"}-${periodo.de}-a-${periodo.ate}.pdf`;
}
