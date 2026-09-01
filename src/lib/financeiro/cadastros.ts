import { db } from "../db";
import { cnpjValido, cpfValido, soDigitos } from "../documento";

/**
 * MÓDULO FINANCEIRO (RN-029) — Fase 1: os cadastros-fundação.
 *
 * Tudo no financeiro aponta para cinco cadastros: contas (onde o dinheiro
 * mora), categorias (a etiqueta do dinheiro), centros de custo, coleções e
 * fornecedores. Duas regras da fase moram aqui:
 *
 *  • CADASTRO NÃO SE APAGA, SE ARQUIVA. Quando os lançamentos chegarem
 *    (Fase 2), apagar uma conta/categoria com histórico quebraria extrato e
 *    DRE — então a API nem tem DELETE. Arquivado some das escolhas novas.
 *  • A ÁRVORE DE CATEGORIAS NASCE PRONTA. Configurar plano de contas é
 *    trabalho de contador — a lojista abre e já encontra as categorias que
 *    uma loja de moda usa (tecido, facção, comissão, taxa de maquininha...).
 *    A semeadura é idempotente: roda na primeira abertura e nunca duplica.
 */

export type TipoCategoria = "RECEITA" | "DESPESA";

export type CategoriaPadrao = {
  codigo: string; // "04.02" — o pai é o código sem o último pedaço ("04")
  nome: string;
  tipo: TipoCategoria;
};

/**
 * A árvore pronta para moda (atacado e varejo). Códigos 01–02 são receitas,
 * 03–06 despesas — a numeração deixa espaço para a loja criar as dela sem
 * colidir. `sistema: true` no banco: renomeável, mas não muda de tipo.
 */
export const CATEGORIAS_PADRAO: CategoriaPadrao[] = [
  // ---- receitas -----------------------------------------------------------
  { codigo: "01", nome: "Receitas de Vendas", tipo: "RECEITA" },
  { codigo: "01.01", nome: "Venda no atacado", tipo: "RECEITA" },
  { codigo: "01.02", nome: "Venda no varejo", tipo: "RECEITA" },
  { codigo: "01.03", nome: "Venda loja online / marketplaces", tipo: "RECEITA" },
  { codigo: "01.04", nome: "Frete cobrado da cliente", tipo: "RECEITA" },
  { codigo: "02", nome: "Outras Receitas", tipo: "RECEITA" },
  { codigo: "02.01", nome: "Juros e multas recebidos", tipo: "RECEITA" },
  { codigo: "02.02", nome: "Outras entradas", tipo: "RECEITA" },
  // ---- custos da mercadoria ----------------------------------------------
  { codigo: "03", nome: "Custos da Mercadoria", tipo: "DESPESA" },
  { codigo: "03.01", nome: "Compra de mercadoria pronta", tipo: "DESPESA" },
  { codigo: "03.02", nome: "Tecidos e aviamentos", tipo: "DESPESA" },
  { codigo: "03.03", nome: "Facção e costura", tipo: "DESPESA" },
  { codigo: "03.04", nome: "Lavanderia e acabamento", tipo: "DESPESA" },
  { codigo: "03.05", nome: "Embalagens", tipo: "DESPESA" },
  // ---- despesas com vendas ------------------------------------------------
  { codigo: "04", nome: "Despesas com Vendas", tipo: "DESPESA" },
  { codigo: "04.01", nome: "Comissões de vendedoras", tipo: "DESPESA" },
  { codigo: "04.02", nome: "Frete e envios", tipo: "DESPESA" },
  { codigo: "04.03", nome: "Taxas de maquininha e Pix", tipo: "DESPESA" },
  { codigo: "04.04", nome: "Taxas de marketplace", tipo: "DESPESA" },
  { codigo: "04.05", nome: "Anúncios e marketing", tipo: "DESPESA" },
  // ---- despesas administrativas ------------------------------------------
  { codigo: "05", nome: "Despesas Administrativas", tipo: "DESPESA" },
  { codigo: "05.01", nome: "Aluguel e condomínio", tipo: "DESPESA" },
  { codigo: "05.02", nome: "Água, luz e internet", tipo: "DESPESA" },
  { codigo: "05.03", nome: "Salários e encargos", tipo: "DESPESA" },
  { codigo: "05.04", nome: "Retirada dos sócios", tipo: "DESPESA" },
  { codigo: "05.05", nome: "Contador e serviços", tipo: "DESPESA" },
  { codigo: "05.06", nome: "Sistemas e assinaturas", tipo: "DESPESA" },
  { codigo: "05.07", nome: "Impostos e taxas", tipo: "DESPESA" },
  { codigo: "05.08", nome: "Manutenção e equipamentos", tipo: "DESPESA" },
  { codigo: "05.09", nome: "Outras despesas", tipo: "DESPESA" },
  // ---- financeiras --------------------------------------------------------
  { codigo: "06", nome: "Despesas Financeiras", tipo: "DESPESA" },
  { codigo: "06.01", nome: "Tarifas bancárias", tipo: "DESPESA" },
  { codigo: "06.02", nome: "Juros e multas pagos", tipo: "DESPESA" },
  { codigo: "06.03", nome: "Parcelas de empréstimos", tipo: "DESPESA" },
  // ---- investimentos (o que a loja COMPRA para durar: máquina, reforma) ---
  { codigo: "07", nome: "Investimentos", tipo: "DESPESA" },
  { codigo: "07.01", nome: "Máquinas e equipamentos", tipo: "DESPESA" },
  { codigo: "07.02", nome: "Reforma e instalações", tipo: "DESPESA" },
  { codigo: "07.03", nome: "Móveis e informática", tipo: "DESPESA" },
];

/** "04.02" → "04"; código de topo ("04") → null. */
export function paiDoCodigo(codigo: string): string | null {
  const i = codigo.lastIndexOf(".");
  return i === -1 ? null : codigo.slice(0, i);
}

/**
 * Próximo código livre debaixo de um pai ("05" com filhas até 05.09 → 05.10;
 * sem pai, o próximo número de topo). É o servidor quem numera — a lojista
 * escolhe nome e lugar, nunca digita código (código digitado colide).
 */
export function proximoCodigo(existentes: string[], paiCodigo: string | null): string {
  const prefixo = paiCodigo ? `${paiCodigo}.` : "";
  const nivel = paiCodigo ? paiCodigo.split(".").length + 1 : 1;
  let maior = 0;
  for (const c of existentes) {
    if (!c.startsWith(prefixo) || c.split(".").length !== nivel) continue;
    const ultimo = Number(c.slice(prefixo.length));
    if (Number.isFinite(ultimo) && ultimo > maior) maior = ultimo;
  }
  return `${prefixo}${String(maior + 1).padStart(2, "0")}`;
}

/**
 * Garante a árvore padrão da loja: semeia na primeira vez e COMPLETA o que
 * faltar depois (grupo novo entra para quem já usava o módulo — sem isso a
 * loja antiga nunca veria "Investimentos" e o DFC dela nasceria torto).
 *
 * Idempotente de dois jeitos: só escreve o que falta, e o `skipDuplicates`
 * em cima do único (companyId, codigo) segura a corrida de duas abas juntas.
 * O caminho comum — nada a fazer — é UMA consulta e nenhuma escrita.
 */
export async function garantirCategoriasPadrao(companyId: string): Promise<void> {
  const existentes = await db.finCategoria.findMany({
    where: { companyId },
    select: { codigo: true, tipo: true, sistema: true },
  });
  const porCodigo = new Map(existentes.map((c) => [c.codigo, c]));
  const livre = (c: CategoriaPadrao) => !porCodigo.has(c.codigo);

  // Só semeia debaixo de um pai que seja MESMO o nosso: a loja pode ter
  // criado uma categoria dela que ficou com o código "07" (`proximoCodigo`
  // numera na ordem), e pendurar "07.01 Máquinas" ali dentro colocaria
  // despesa de sistema debaixo de categoria da lojista — e o DFC leria
  // aquilo tudo como investimento.
  const nossoPai = (codigo: string, tipo: TipoCategoria) => {
    const pai = paiDoCodigo(codigo);
    if (!pai) return true;
    const dono = porCodigo.get(pai);
    return Boolean(dono?.sistema) && dono?.tipo === tipo;
  };

  const faltando = CATEGORIAS_PADRAO.filter(livre);
  if (faltando.length === 0) return;

  // pais primeiro (createMany não devolve ids — busca depois para ligar as filhas)
  const pais = faltando.filter((c) => paiDoCodigo(c.codigo) === null);
  if (pais.length > 0) {
    await db.finCategoria.createMany({
      data: pais.map((c) => ({ companyId, ...c, sistema: true })),
      skipDuplicates: true,
    });
    for (const c of pais) porCodigo.set(c.codigo, { ...c, sistema: true });
  }
  const todas = await db.finCategoria.findMany({
    where: { companyId },
    select: { id: true, codigo: true },
  });
  const idPorCodigo = new Map(todas.map((c) => [c.codigo, c.id]));

  const filhas = faltando.filter(
    (c) => paiDoCodigo(c.codigo) !== null && nossoPai(c.codigo, c.tipo)
  );
  if (filhas.length > 0) {
    await db.finCategoria.createMany({
      data: filhas.map((c) => ({
        companyId,
        ...c,
        sistema: true,
        paiId: idPorCodigo.get(paiDoCodigo(c.codigo)!) ?? null,
      })),
      skipDuplicates: true,
    });
  }
}

/**
 * Confere os documentos do fornecedor ANTES de gravar (mesma régua da ficha
 * de cliente): documento inválido só aparece lá na frente — na etiqueta, na
 * nota — com a compra já feita. Devolve a mensagem do problema ou null.
 */
export function conferirDocumentosFornecedor(dados: {
  cnpj?: string | null;
  cpf?: string | null;
}): string | null {
  if (dados.cnpj && soDigitos(dados.cnpj) && !cnpjValido(dados.cnpj))
    return "CNPJ inválido — confira os dígitos";
  if (dados.cpf && soDigitos(dados.cpf) && !cpfValido(dados.cpf))
    return "CPF inválido — confira os dígitos";
  return null;
}
