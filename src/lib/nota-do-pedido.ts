/**
 * A NOTA DO PEDIDO EM TRÊS PARTES (pedido do dono, 05/10/2026).
 *
 * `Order.notes` nasceu como um bilhete só, e virou uma sacola: o sistema
 * escreve nela quando o pedido nasce (o cabeçalho do catálogo com Nome,
 * Telefone e CEP — RN-010/RN-027 —, "Pedido lançado a partir da mensagem do
 * WhatsApp", "Venda da loja online", o aviso de falta de estoque, o carimbo
 * do link de campanha) e a vendedora escreve o recado dela por cima
 * ("separar só na sexta", "todas entregues, exceto a regata").
 *
 * O dono olhou o romaneio e a ficha e pediu: *"nesse campo não quero outros
 * dados, somente a observação feita pelo vendedor"*. Então a leitura separa:
 *
 *   - `dados`      → o que identifica o pedido e a cliente (linhas rotuladas
 *                    do catálogo, a origem do pedido);
 *   - `avisos`     → o que o sistema precisa que alguém leia (⚠️ falta de
 *                    estoque, ⚠️ telefone divergente, 🏷 desconto do link);
 *   - `observacao` → o que sobra: o recado escrito por gente.
 *
 * A nota GRAVADA não muda de formato — pedido antigo e novo passam pela mesma
 * régua, e nenhum dos cinco caminhos que criam pedido precisou aprender uma
 * coluna nova. O preço disso é dito: toda frase que o sistema escreve na nota
 * tem que estar reconhecida aqui (o teste confere as frases contra o código
 * que as escreve). Frase do sistema que esta régua não conhece aparece como
 * observação — o erro cai para o lado em que nada se perde.
 */

/** cabeçalho do catálogo: o romaneio já diz "catálogo" no título do bloco */
const CABECALHO_DO_CATALOGO = /^pedido recebido pelo cat[áa]logo p[úu]blico\.?$/i;

/** linhas rotuladas que o catálogo e o "Colar pedido do WhatsApp" escrevem */
const LINHA_ROTULADA =
  /^(nome da loja|loja da cliente|loja|nome|telefone|fone|whatsapp|cep|endere[çc]o(?:\s*\(rua e n[úu]mero\))?|bairro|cidade|estado(?:\s*\(uf\))?)\s*:/i;

/** a origem do pedido, escrita por quem o criou */
const ORIGEM_DO_PEDIDO = [
  /^pedido lan[çc]ado a partir da mensagem do whatsapp\.?$/i,
  /^venda da loja online \(nuvemshop/i,
];

/**
 * O que o sistema grita na nota — cada frase corresponde a UM lugar do código
 * que a escreve (o teste prende a lista às fontes):
 *   catálogo:  telefone divergente, condição do link mudou, sem estoque, link
 *              da campanha com desconto;
 *   colar do WhatsApp: campanha que não confere, linhas que não entraram,
 *              link da campanha com desconto.
 */
const AVISOS_DO_SISTEMA = [
  /^⚠️\s*a cliente digitou um telefone diferente/i,
  /^⚠️\s*as condi[çc][õo]es deste link mudaram/i,
  /^⚠️\s*sem estoque para parte do pedido/i,
  /^⚠️\s*a mensagem citava a campanha/i,
  /^⚠️\s*\d+ linha\(s\) da mensagem n[ãa]o entraram/i,
  /^🏷\s*link da campanha/i,
];

export type NotaDoPedido = {
  /** dados da cliente e do pedido ("Nome: …", "CEP: …", a origem) */
  dados: string[];
  /** avisos do sistema (⚠️ falta, ⚠️ telefone, 🏷 desconto do link) */
  avisos: string[];
  /** o recado escrito por gente, com as quebras de linha da pessoa */
  observacao: string;
};

export function separarNotaDoPedido(notes: string | null | undefined): NotaDoPedido {
  const dados: string[] = [];
  const avisos: string[] = [];
  const resto: string[] = [];
  for (const linha of (notes ?? "").split("\n")) {
    const t = linha.trim();
    if (CABECALHO_DO_CATALOGO.test(t)) continue;
    if (LINHA_ROTULADA.test(t) || ORIGEM_DO_PEDIDO.some((re) => re.test(t))) dados.push(t);
    else if (AVISOS_DO_SISTEMA.some((re) => re.test(t))) avisos.push(t);
    else resto.push(linha);
  }
  return { dados, avisos, observacao: resto.join("\n").trim() };
}

/** tudo que não é o recado da vendedora, na ordem em que estava na nota */
export function linhasDoSistema(notes: string | null | undefined): string[] {
  const sistema: string[] = [];
  for (const linha of (notes ?? "").split("\n")) {
    const t = linha.trim();
    if (!t) continue;
    if (
      CABECALHO_DO_CATALOGO.test(t) ||
      LINHA_ROTULADA.test(t) ||
      ORIGEM_DO_PEDIDO.some((re) => re.test(t)) ||
      AVISOS_DO_SISTEMA.some((re) => re.test(t))
    )
      sistema.push(t);
  }
  return sistema;
}

/**
 * Remonta a nota para gravar: o que o sistema escreveu fica como estava
 * (inclusive o cabeçalho do catálogo, que a leitura esconde) e o recado da
 * vendedora entra depois. Recado vazio apaga só o recado — os dados do
 * pedido não somem porque a lojista limpou a observação.
 */
export function montarNota(notesAtual: string | null | undefined, observacao: string): string {
  const sistema = linhasDoSistema(notesAtual);
  const recado = observacao.trim();
  return [...sistema, ...(recado ? [recado] : [])].join("\n");
}

/** tira UMA linha do sistema da nota (o aviso velho que a loja já resolveu) */
export function removerLinhaDoSistema(notesAtual: string | null | undefined, linha: string): string {
  const alvo = linha.trim();
  let tirou = false;
  const linhas = (notesAtual ?? "").split("\n").filter((l) => {
    if (!tirou && l.trim() === alvo) {
      tirou = true;
      return false;
    }
    return true;
  });
  return linhas.join("\n").trim();
}
