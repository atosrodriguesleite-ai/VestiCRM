import { db } from "./db";
import {
  corDoNome,
  lerVariacoesNuvemshop,
  mesmaCor,
  norm,
  type VariacaoNs,
} from "./nuvemshop";

/**
 * CONFERÊNCIA DA INTEGRAÇÃO COM A NUVEMSHOP — SÓ LEITURA.
 *
 * Por que isto existe (incidente real, loja Toque Leve, 30/07/2026): a lojista
 * duplicou SKU na Nuvemshop sem querer e corrigiu depois. Só que o casamento
 * das variações é gravado como um CARIMBO na nossa variação
 * (`ProductVariant.nuvemshopId`) e, na sincronização, o carimbo tem
 * PRIORIDADE sobre o SKU. Resultado: corrigir o SKU lá pode NÃO desfazer o
 * vínculo errado aqui — o erro fica preso, e o estoque de uma peça continua
 * caindo em cima de outra.
 *
 * "0 pendências" no relatório do sync não prova que está certo: prova só que
 * toda variação achou ALGUM par, não que achou o par CORRETO. Esta conferência
 * é o que responde a pergunta certa — e ela não altera nada, nem aqui nem lá.
 */

/** Variação como ela está AQUI (com o carimbo do vínculo). */
export type VariacaoAqui = {
  id: string;
  produto: string;
  cor: string;
  tamanho: string;
  sku: string | null;
  estoque: number;
  /** carimbo: id da variação da Nuvemshop que o sistema acha que é esta peça */
  nsVarId: string | null;
};

/**
 * Duas (ou mais) sincronizações mexendo na MESMA variação no MESMO minuto.
 * É a impressão digital do SKU duplicado: duas peças de lá brigando pela
 * mesma peça daqui.
 */
export type Briga = {
  variantId: string;
  quando: Date;
  quantos: number;
  historico: string[];
};

export type TipoAchado =
  | "SKU_DUPLICADO_NOS_DOIS"
  | "SKU_DUPLICADO_AQUI"
  | "SKU_DUPLICADO_LA"
  | "CARIMBO_CRUZADO"
  | "CARIMBO_ORFAO"
  | "COR_FORA_DO_PRODUTO"
  | "BRIGA_DE_SYNC"
  | "ESTOQUE_DIFERENTE";

export type Achado = {
  tipo: TipoAchado;
  gravidade: "ALTA" | "MEDIA";
  /** nome legível da peça, do jeito que a lojista enxerga na tela Produtos */
  peca: string;
  detalhe: string;
  estoqueAqui?: number;
  estoqueLa?: number;
};

const rotulo = (v: { produto: string; cor: string; tamanho: string }) =>
  `${v.produto} · ${v.cor} ${v.tamanho}`.replace(/\s+/g, " ").trim();

/** Agrupa por SKU normalizado, ignorando quem não tem SKU. */
function porSku<T extends { sku: string | null }>(itens: T[]) {
  const mapa = new Map<string, T[]>();
  for (const i of itens) {
    const k = norm(i.sku);
    if (!k) continue;
    const atual = mapa.get(k);
    if (atual) atual.push(i);
    else mapa.set(k, [i]);
  }
  return mapa;
}

/**
 * Regra pura da conferência: compara as duas fotos (aqui × Nuvemshop) e devolve
 * o que está torto. Sem banco, sem rede — é o coração testável.
 */
export function conferirVinculo(
  aqui: VariacaoAqui[],
  la: VariacaoNs[],
  brigas: Briga[] = []
): Achado[] {
  const achados: Achado[] = [];
  const laPorVarId = new Map(la.map((v) => [v.varId, v]));
  const aquiPorId = new Map(aqui.map((v) => [v.id, v]));

  // 1+2. SKU REPETIDO. Um SKU só pode apontar para uma peça — repetido, o
  //      sistema atualiza uma e congela a outra. O MESMO SKU repetido dos dois
  //      lados é UM problema, não dois: sai num aviso só (na primeira
  //      conferência da Toque Leve isso sozinho dobrava o tamanho da lista).
  const dupAqui = new Map([...porSku(aqui)].filter(([, l]) => l.length > 1));
  const dupLa = new Map([...porSku(la)].filter(([, l]) => l.length > 1));
  for (const [chave, iguais] of dupAqui) {
    const tambemLa = dupLa.get(chave);
    achados.push({
      tipo: tambemLa ? "SKU_DUPLICADO_NOS_DOIS" : "SKU_DUPLICADO_AQUI",
      gravidade: "ALTA",
      peca: `SKU ${iguais[0].sku} · ${iguais.map(rotulo).join("  ⇄  ")}`,
      detalhe: tambemLa
        ? `O SKU ${iguais[0].sku} está repetido NOS DOIS LADOS (${tambemLa.length} peças na Nuvemshop, ${iguais.length} variações aqui). Enquanto estiver repetido lá, toda sincronização volta a embaralhar: corrija primeiro na Nuvemshop, depois aqui.`
        : `${iguais.length} variações daqui estão com o MESMO SKU (${iguais[0].sku}). O sistema só consegue atualizar uma delas — a outra fica com o estoque congelado.`,
    });
  }
  for (const [chave, iguais] of dupLa) {
    if (dupAqui.has(chave)) continue; // já saiu no aviso combinado
    achados.push({
      tipo: "SKU_DUPLICADO_LA",
      gravidade: "ALTA",
      peca: `SKU ${iguais[0].sku} · ${iguais.map(rotulo).join("  ⇄  ")}`,
      detalhe: `${iguais.length} peças na Nuvemshop estão com o MESMO SKU (${iguais[0].sku}). Elas brigam pela mesma variação aqui: a última lida ganha.`,
    });
  }

  // 2.5. COR MORANDO NO PRODUTO ERRADO — foi o que aconteceu na Toque Leve:
  //      a cor "cafe" foi criada DENTRO de "Baby Look — Branco". No catálogo
  //      ela virou um card a mais, com a foto do branco; na tela Produtos o
  //      branco apareceu com o estoque somado (395 em vez de ~197).
  //      Quando o produto declara a cor no nome ("Peça — Branco"), toda
  //      variação dele tem que ser dessa cor. Agrupa por produto+cor para não
  //      repetir o mesmo aviso em cada tamanho.
  const forasDeCasa = new Map<string, { v: VariacaoAqui; corDoProduto: string; qtd: number }>();
  for (const v of aqui) {
    const corProduto = corDoNome(v.produto);
    if (!corProduto) continue;
    // mesma tolerância da sincronização: "Único" e nomes que se contêm passam
    if (mesmaCor(v.cor, corProduto)) continue;
    const k = `${v.produto}|${norm(v.cor)}`;
    const atual = forasDeCasa.get(k);
    if (atual) atual.qtd++;
    else forasDeCasa.set(k, { v, corDoProduto: corProduto, qtd: 1 });
  }
  for (const { v, corDoProduto, qtd } of forasDeCasa.values()) {
    achados.push({
      tipo: "COR_FORA_DO_PRODUTO",
      gravidade: "ALTA",
      peca: `${v.produto} → cor “${v.cor}”`,
      detalhe: `O produto se chama “${v.produto}” (cor ${corDoProduto}), mas tem ${qtd} variação(ões) da cor “${v.cor}” dentro dele. Isso soma o estoque das duas cores na mesma peça e faz o catálogo mostrar um card a mais, com a foto errada. A cor “${v.cor}” precisa virar produto próprio.`,
      estoqueAqui: v.estoque,
    });
  }

  for (const v of aqui) {
    if (!v.nsVarId) continue;
    const par = laPorVarId.get(v.nsVarId);

    // 3. Carimbo órfão: a peça de lá não existe mais (apagada/recriada). O
    //    carimbo velho continua atravessado na frente do SKU.
    if (!par) {
      achados.push({
        tipo: "CARIMBO_ORFAO",
        gravidade: "MEDIA",
        peca: rotulo(v),
        detalhe:
          "O vínculo aponta para uma peça que não existe mais na Nuvemshop (foi apagada ou recriada). Enquanto o vínculo velho estiver aí, ele passa na frente do SKU.",
        estoqueAqui: v.estoque,
      });
      continue;
    }

    // 4. CARIMBO CRUZADO — o achado que pega o caso do SKU duplicado: o
    //    vínculo diz uma coisa e o SKU diz outra. Como o vínculo manda, o
    //    estoque está vindo da peça ERRADA.
    if (v.sku && par.sku && norm(v.sku) !== norm(par.sku)) {
      achados.push({
        tipo: "CARIMBO_CRUZADO",
        gravidade: "ALTA",
        peca: rotulo(v),
        detalhe: `O vínculo diz que esta peça é a “${rotulo(par)}” da Nuvemshop (SKU ${par.sku}), mas o SKU daqui é ${v.sku}. O estoque está vindo da peça errada — provável resíduo do SKU duplicado.`,
        estoqueAqui: v.estoque,
        estoqueLa: par.estoque,
      });
      continue;
    }

    // 5. Estoque diferente com vínculo saudável: pode ser só uma venda no meio
    //    do caminho, mas logo depois de sincronizar deveria estar igual.
    if (v.estoque !== par.estoque) {
      achados.push({
        tipo: "ESTOQUE_DIFERENTE",
        gravidade: "MEDIA",
        peca: rotulo(v),
        detalhe:
          "O vínculo está certo, mas o estoque dos dois lados não bate. Se você acabou de sincronizar, isso merece um olhar (pode ser venda no meio do caminho).",
        estoqueAqui: v.estoque,
        estoqueLa: par.estoque,
      });
    }
  }

  // 6. Briga de sincronização: prova histórica de que duas peças de lá mexeram
  //    na mesma variação daqui no mesmo minuto.
  for (const b of brigas) {
    const v = aquiPorId.get(b.variantId);
    achados.push({
      tipo: "BRIGA_DE_SYNC",
      gravidade: "ALTA",
      peca: v ? rotulo(v) : "Variação removida",
      detalhe: `${b.quantos} ajustes de sincronização na mesma variação em ${b.quando.toLocaleString("pt-BR")} — assinatura de duas peças da Nuvemshop disputando esta peça. Histórico: ${b.historico.join(" → ")}`,
      estoqueAqui: v?.estoque,
    });
  }

  // A ordem da lista É a ordem de consertar. Arrumar SKU na Nuvemshop vem
  // ANTES de tudo: enquanto ele estiver repetido lá, toda sincronização
  // desfaz o conserto feito aqui.
  return achados.sort(
    (a, b) => ORDEM_DE_CONSERTO.indexOf(a.tipo) - ORDEM_DE_CONSERTO.indexOf(b.tipo)
  );
}

/** Ordem em que os problemas devem ser resolvidos (é a ordem da lista). */
export const ORDEM_DE_CONSERTO: TipoAchado[] = [
  "SKU_DUPLICADO_NOS_DOIS",
  "SKU_DUPLICADO_LA",
  "SKU_DUPLICADO_AQUI",
  "COR_FORA_DO_PRODUTO",
  "CARIMBO_CRUZADO",
  "BRIGA_DE_SYNC",
  "CARIMBO_ORFAO",
  "ESTOQUE_DIFERENTE",
];

/** Nome curto de cada tipo, para o resumo do topo. */
export const NOME_DO_TIPO: Record<TipoAchado, string> = {
  SKU_DUPLICADO_NOS_DOIS: "SKU repetido nos dois lados",
  SKU_DUPLICADO_LA: "SKU repetido na Nuvemshop",
  SKU_DUPLICADO_AQUI: "SKU repetido aqui",
  COR_FORA_DO_PRODUTO: "Cor no produto errado",
  CARIMBO_CRUZADO: "Vínculo apontando pra peça errada",
  BRIGA_DE_SYNC: "Peça disputada na sincronização",
  CARIMBO_ORFAO: "Vínculo sem peça na Nuvemshop",
  ESTOQUE_DIFERENTE: "Estoque não bate",
};

/**
 * Resumo por tipo, na ordem de consertar. Sessenta linhas soltas assustam;
 * "12 SKUs repetidos + 3 cores no lugar errado" é uma lista de tarefas.
 */
export function resumir(achados: Achado[]) {
  const conta = new Map<TipoAchado, number>();
  for (const a of achados) conta.set(a.tipo, (conta.get(a.tipo) ?? 0) + 1);
  return ORDEM_DE_CONSERTO.filter((t) => conta.has(t)).map((t) => ({
    tipo: t,
    nome: NOME_DO_TIPO[t],
    quantos: conta.get(t)!,
  }));
}

/**
 * Encontra as brigas no histórico de estoque: ajustes da sincronização da
 * Nuvemshop na MESMA variação, no MESMO minuto. Só leitura.
 */
export async function acharBrigas(companyId: string): Promise<Briga[]> {
  const movs = await db.inventoryMovement.findMany({
    where: {
      companyId,
      type: "AJUSTE",
      reason: { startsWith: "Sincronização Nuvemshop" },
    },
    orderBy: { createdAt: "desc" },
    take: 3000,
    select: { variantId: true, createdAt: true, reason: true },
  });

  // chave = variação + minuto (o sync roda em rajada; o minuto é o bastante)
  const grupos = new Map<
    string,
    { variantId: string; quando: Date; historico: string[] }
  >();
  for (const m of movs) {
    const minuto = new Date(m.createdAt);
    minuto.setSeconds(0, 0);
    const k = `${m.variantId}|${minuto.toISOString()}`;
    const atual = grupos.get(k);
    const trecho = (m.reason ?? "").replace("Sincronização Nuvemshop ", "");
    if (atual) atual.historico.push(trecho);
    else grupos.set(k, { variantId: m.variantId, quando: minuto, historico: [trecho] });
  }

  return [...grupos.values()]
    .filter((g) => g.historico.length > 1)
    .map((g) => ({
      variantId: g.variantId,
      quando: g.quando,
      quantos: g.historico.length,
      // do mais antigo pro mais novo, que é como a pessoa lê
      historico: g.historico.slice().reverse(),
    }));
}

/**
 * Conferência completa: lê os dois lados, cruza e devolve o relatório.
 * NÃO escreve nada — pode rodar em loja em produção sem medo.
 */
export async function conferirIntegracao(companyId: string) {
  const [ns, variantes, brigas] = await Promise.all([
    lerVariacoesNuvemshop(companyId),
    db.productVariant.findMany({
      where: { product: { companyId } },
      select: {
        id: true,
        color: true,
        size: true,
        sku: true,
        stock: true,
        nuvemshopId: true,
        product: { select: { name: true } },
      },
    }),
    acharBrigas(companyId),
  ]);

  if (!ns.ok) return { ok: false as const, status: ns.status };

  const aqui: VariacaoAqui[] = variantes.map((v) => ({
    id: v.id,
    produto: v.product.name,
    cor: v.color,
    tamanho: v.size,
    sku: v.sku,
    estoque: v.stock,
    nsVarId: v.nuvemshopId,
  }));

  const achados = conferirVinculo(aqui, ns.variacoes, brigas);
  return {
    ok: true as const,
    produtosNs: ns.produtos,
    variacoesNs: ns.variacoes.length,
    variacoesAqui: aqui.length,
    vinculadas: aqui.filter((v) => v.nsVarId).length,
    semSku: aqui.filter((v) => !norm(v.sku)).length,
    resumo: resumir(achados),
    achados: achados.slice(0, 200),
    total: achados.length,
  };
}
