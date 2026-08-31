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
 * Uma VARIAÇÃO daqui disputada por duas peças da Nuvemshop — a impressão
 * digital do SKU duplicado (duas sincronizações mexendo nela no mesmo minuto).
 *
 * É UM achado por PEÇA, não por rodada de sincronização (revisão 19/08/2026):
 * a disputa se repete em TODA sincronização enquanto o SKU estiver duplicado,
 * e contar cada repetição enchia a conferência da Entre Linhas com 564 avisos
 * de meia dúzia de peças. Pior: como a lista mostra um teto de achados, os 564
 * empurravam para fora da tela justamente os "vínculo sem peça na Nuvemshop"
 * — a lojista via o número no resumo e nunca descobria QUAIS peças eram.
 */
export type Briga = {
  variantId: string;
  /** quando foi a ÚLTIMA disputa */
  quando: Date;
  /** em quantas sincronizações esta peça já foi disputada */
  rodadas: number;
  /** os ajustes da última rodada disputada (o que dá para ler) */
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
  /**
   * Qual variação daqui o achado aponta — é o que permite CONSERTAR (soltar o
   * vínculo torto), não só diagnosticar. A tela nunca manda este id de volta:
   * o servidor reconfere e decide sozinho (relato da loja, 31/08/2026 — a
   * conferência mostrava 12 vínculos errados e a lojista não tinha como
   * desfazer nenhum).
   */
  variantId?: string;
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
export type BrigaResolvida = { peca: string; quando: Date };

export function conferirVinculo(
  aqui: VariacaoAqui[],
  la: VariacaoNs[],
  brigas: Briga[] = []
): Achado[] {
  return conferirComHistorico(aqui, la, brigas).achados;
}

/**
 * A conferência inteira: o que precisa de AÇÃO (`achados`) e o que já passou
 * (`resolvidas`). Separar os dois é o que faz o número do topo dizer a
 * verdade — antes ele somava 45 lembranças de brigas já consertadas às 5
 * tarefas de verdade (pedido do dono, 31/08/2026).
 */
export function conferirComHistorico(
  aqui: VariacaoAqui[],
  la: VariacaoNs[],
  brigas: Briga[] = [],
  leituraCompleta = true
): { achados: Achado[]; resolvidas: BrigaResolvida[] } {
  const resolvidas: BrigaResolvida[] = [];
  const achados: Achado[] = [];
  const laPorVarId = new Map(la.map((v) => [v.varId, v]));
  const aquiPorId = new Map(aqui.map((v) => [v.id, v]));

  // 1+2. SKU REPETIDO. Um SKU só pode apontar para uma peça — repetido, o
  //      sistema atualiza uma e congela a outra. O MESMO SKU repetido dos dois
  //      lados é UM problema, não dois: sai num aviso só (na primeira
  //      conferência da Toque Leve isso sozinho dobrava o tamanho da lista).
  const dupAqui = new Map([...porSku(aqui)].filter(([, l]) => l.length > 1));
  const dupLa = new Map([...porSku(la)].filter(([, l]) => l.length > 1));

  // PEÇAS COM A CAUSA AINDA VIVA. A pergunta "esta disputa ainda acontece?"
  // não se faz ao relógio (rodada longa e sync que não mexe em nada enganam
  // qualquer folga de tempo) — se faz ao estado de AGORA: enquanto o SKU
  // estiver repetido, ou o vínculo apontando para a peça errada, a próxima
  // sincronização disputa de novo. Corrigido, o que sobra é histórico.
  const causaViva = new Set<string>();
  for (const iguais of dupAqui.values()) for (const v of iguais) causaViva.add(v.id);
  // A regra geral: a sincronização chega numa variação daqui por DOIS
  // caminhos — o carimbo do vínculo e o SKU. Se cada caminho leva a uma peça
  // DIFERENTE da Nuvemshop, as duas escrevem nela em toda rodada: a disputa
  // está viva. (Olhar só o SKU repetido deixava passar o caso da peça de lá
  // sem SKU carimbada aqui enquanto outra peça de lá carrega o SKU daqui.)
  const laPorSku = porSku(la);
  for (const v of aqui) {
    const alcancam = new Set<string>();
    const peloCarimbo = v.nsVarId ? laPorVarId.get(v.nsVarId) : undefined;
    if (peloCarimbo) alcancam.add(peloCarimbo.varId);
    for (const p of laPorSku.get(norm(v.sku)) ?? []) alcancam.add(p.varId);
    if (alcancam.size > 1) causaViva.add(v.id);
  }
  // (o CARIMBO CRUZADO também segura a disputa: quem marca é o próprio achado,
  // lá embaixo, que roda antes do laço das brigas. Peça SEM SKU aqui é
  // alcançada só pelo carimbo — uma escritora, nenhuma disputa: a briga velha
  // dela é história, não alarme.)
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
        variantId: v.id,
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
      causaViva.add(v.id);
      achados.push({
        tipo: "CARIMBO_CRUZADO",
        gravidade: "ALTA",
        peca: rotulo(v),
        variantId: v.id,
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
  //
  //    A BRIGA QUE JÁ PAROU NÃO É TAREFA (pedido do dono, 31/08/2026): a loja
  //    consertou o SKU, a disputa acabou, e mesmo assim o painel dizia "50
  //    pontos para olhar" — 45 deles eram lembrança de brigas resolvidas. Um
  //    número que conta o que NÃO precisa de ação assusta e esconde as 4
  //    coisas que precisam. Agora ela sai da lista e da conta, e vira uma
  //    linha tranquila no rodapé ("já resolvidas").
  for (const b of brigas) {
    const v = aquiPorId.get(b.variantId);
    const quando = b.quando.toLocaleString("pt-BR");
    // "ao menos": a varredura olha as movimentações mais recentes, então
    // rodadas antigas podem ficar de fora — nunca prometer exatidão
    const vezes =
      b.rodadas === 1 ? "ao menos 1 sincronização" : `ao menos ${b.rodadas} sincronizações`;
    const aindaAcontece = causaViva.has(b.variantId);
    // "ACABOU" SÓ SE DEU PARA CONFERIR (achado da revisão de 31/08/2026):
    // quando a leitura da Nuvemshop veio pela metade (página que falhou,
    // catálogo além do teto), a peça que causa a disputa pode ser justamente
    // uma das que não vieram — e o silêncio viraria "nada a fazer" com o
    // estoque embaralhando a cada sincronização. Na dúvida, AVISA.
    if (!aindaAcontece && leituraCompleta) {
      resolvidas.push({
        peca: v ? rotulo(v) : "Variação removida",
        quando: b.quando,
      });
      continue;
    }
    achados.push({
      tipo: "BRIGA_DE_SYNC",
      gravidade: aindaAcontece ? "ALTA" : "MEDIA",
      peca: v ? rotulo(v) : "Variação removida",
      detalhe: aindaAcontece
        ? `Duas peças da Nuvemshop estão disputando esta variação — o estoque dela fica com o número da última lida. Já aconteceu em ${vezes} (a última em ${quando}): ${b.historico.join(" → ")}`
        : `Esta variação já foi disputada por duas peças da Nuvemshop em ${vezes} (a última em ${quando}): ${b.historico.join(" → ")}. Não deu pra conferir o catálogo da Nuvemshop nesta rodada, então não dá pra dizer que acabou — confira de novo depois.`,
      estoqueAqui: v?.estoque,
    });
  }

  // A ordem da lista É a ordem de consertar. Arrumar SKU na Nuvemshop vem
  // ANTES de tudo: enquanto ele estiver repetido lá, toda sincronização
  // desfaz o conserto feito aqui.
  return {
    achados: achados.sort(
      (a, b) => ORDEM_DE_CONSERTO.indexOf(a.tipo) - ORDEM_DE_CONSERTO.indexOf(b.tipo)
    ),
    // da mais recente para a mais antiga (é assim que se lê histórico)
    resolvidas: resolvidas.sort((a, b) => b.quando.getTime() - a.quando.getTime()),
  };
}

/** Ordem em que os problemas devem ser resolvidos (é a ordem da lista). */
/**
 * OS VÍNCULOS QUE O SISTEMA SOLTA SOZINHO — regra pura, testável sem banco.
 *
 * Só os dois casos em que o vínculo está objetivamente errado. SKU duplicado
 * e briga de sync ficam de fora de propósito: ali quem decide é a lojista.
 *
 * `leituraCompleta` é a trava do órfão: quando a leitura da Nuvemshop veio
 * pela metade (página que falhou, catálogo além do teto, catálogo que voltou
 * VAZIO), peça NÃO LIDA parece apagada — soltar aí apagaria vínculo BOM.
 * Nesse caso vai só o cruzado, que depende de peça lida de verdade (revisão
 * de 31/08/2026). Quem decide se a leitura serve é
 * `leituraConfiavelParaSoltar` — a MESMA régua que decide se a disputa velha
 * pode ser dada como encerrada.
 */
export type MotivoLeitura = "OK" | "PARCIAL" | "VAZIO";

/**
 * POR QUE a leitura não serviu — "veio pela metade" e "voltou vazia" pedem
 * recados diferentes: mandar "tente de novo daqui a pouco" para uma loja com
 * catálogo legitimamente vazio é um aviso que nunca vai mudar (revisão de
 * 31/08/2026, mesma lição da RN-023).
 */
export function motivoDaLeitura(x: { completa: boolean; variacoesNs: number }): MotivoLeitura {
  if (!x.completa) return "PARCIAL";
  if (x.variacoesNs === 0) return "VAZIO";
  return "OK";
}

export function leituraConfiavelParaSoltar(x: {
  completa: boolean;
  variacoesNs: number;
}): boolean {
  // catálogo vazio não é "a lojista apagou tudo lá": é leitura que não veio
  // (200 com corpo estranho, loja recém-conectada, conexão trocada). Aí TODO
  // vínculo vira órfão e um clique zeraria o catálogo inteiro.
  //
  // E são SÓ estas duas perguntas. Uma trava por PROPORÇÃO de órfãos foi
  // tentada e recusada na mesma revisão: loja que apaga e recria metade dos
  // produtos — o cenário exato do vínculo órfão — ficaria sem conserto para
  // SEMPRE, com a leitura vindo inteira todas as vezes. Quem garante que a
  // leitura veio inteira é o `completa`, e ele erra para o lado seguro.
  return x.completa && x.variacoesNs > 0;
}

export function vinculosParaSoltar(
  achados: Achado[],
  leituraCompleta: boolean
): string[] {
  const tipos: TipoAchado[] = leituraCompleta
    ? ["CARIMBO_CRUZADO", "CARIMBO_ORFAO"]
    : ["CARIMBO_CRUZADO"];
  return [
    ...new Set(
      achados
        .filter((a) => tipos.includes(a.tipo))
        .map((a) => a.variantId)
        .filter((v): v is string => !!v)
    ),
  ];
}

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

/** O número em que o ajuste PAROU: "(197 → 3)" → 3. */
export function destinoDoAjuste(trecho: string): number | null {
  const m = trecho.match(/\((-?\d+)\s*→\s*(-?\d+)\)/);
  return m ? Number(m[2]) : null;
}

/**
 * DOIS AJUSTES NO MESMO MINUTO NEM SEMPRE SÃO BRIGA (Entre Linhas, 19/08/2026).
 *
 * A briga que interessa é a de duas peças da Nuvemshop DISCORDANDO do estoque
 * — uma escreve 3, a outra escreve 198, e a peça daqui fica com o número da
 * última lida. Já a sincronização disparada duas vezes ao mesmo tempo (dois
 * cliques, duas abas) grava o MESMO número duas vezes: a peça termina certa,
 * ninguém disputou nada. Contar isso como briga acusou metade do catálogo da
 * Entre Linhas — 156 peças — sem nada de errado nelas.
 *
 * Regra: só é disputa quando os ajustes do minuto param em números
 * DIFERENTES. Ajuste em formato antigo (sem os números) continua avisando —
 * na dúvida, avisa.
 */
export function ehDisputaDeVerdade(historico: string[]): boolean {
  if (historico.length < 2) return false;
  const destinos = new Set<number>();
  for (const h of historico) {
    const d = destinoDoAjuste(h);
    if (d !== null) destinos.add(d);
  }
  return destinos.size === 0 || destinos.size > 1;
}

/**
 * Encontra as brigas no histórico de estoque: ajustes da sincronização da
 * Nuvemshop na MESMA variação, no MESMO minuto, PARANDO EM NÚMEROS
 * DIFERENTES. Só leitura.
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

  // 1º passo: variação + minuto (o sync roda em rajada; o minuto é o bastante)
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

  // 2º passo: junta as rodadas POR PEÇA, contando só as DISPUTAS DE VERDADE.
  // Enquanto o SKU estiver duplicado a disputa se repete em toda
  // sincronização — e uma linha por repetição transformava meia dúzia de
  // problemas em centenas de avisos.
  const disputadas = [...grupos.values()].filter((g) => ehDisputaDeVerdade(g.historico));
  const porPeca = new Map<string, Briga>();
  for (const g of disputadas) {
    const atual = porPeca.get(g.variantId);
    if (atual) {
      atual.rodadas++;
      if (g.quando > atual.quando) {
        atual.quando = g.quando;
        atual.historico = g.historico.slice().reverse();
      }
      continue;
    }
    porPeca.set(g.variantId, {
      variantId: g.variantId,
      quando: g.quando,
      rodadas: 1,
      // do mais antigo pro mais novo, que é como a pessoa lê
      historico: g.historico.slice().reverse(),
    });
  }
  return [...porPeca.values()].sort((a, b) => b.quando.getTime() - a.quando.getTime());
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

  // A CONFIANÇA NA LEITURA É UMA SÓ (revisão de 31/08/2026): antes o
  // histórico usava `ns.completa` (que diz "sim" para catálogo que voltou
  // VAZIO) e o conserto usava a régua estrita — a tela dizia "nada a fazer"
  // e escondia o botão sem explicar nada.
  const vinculadas = aqui.filter((v) => v.nsVarId).length;
  const leituraConfiavel = leituraConfiavelParaSoltar({
    completa: ns.completa,
    variacoesNs: ns.variacoes.length,
  });

  const { achados, resolvidas } = conferirComHistorico(
    aqui,
    ns.variacoes,
    brigas,
    leituraConfiavel
  );
  const { mostrados, omitidos } = recortarParaTela(achados);
  return {
    ok: true as const,
    produtosNs: ns.produtos,
    variacoesNs: ns.variacoes.length,
    variacoesAqui: aqui.length,
    vinculadas,
    semSku: aqui.filter((v) => !norm(v.sku)).length,
    resumo: resumir(achados),
    achados: mostrados,
    // a lista exibida é recortada por tipo; o CONSERTO precisa de todos —
    // soltar 30 de 45 e dizer "pronto" deixava 15 mandando estoque errado
    paraSoltar: vinculosParaSoltar(achados, leituraConfiavel),
    // é a MESMA régua que segurou o conserto: o aviso âmbar da tela e o
    // recado do botão precisam explicar o que a régua decidiu — e POR QUÊ
    leituraCompleta: leituraConfiavel,
    motivoLeitura: motivoDaLeitura({
      completa: ns.completa,
      variacoesNs: ns.variacoes.length,
    }),
    // quantos ficaram de fora da lista (nunca some em silêncio)
    omitidos,
    // graves conta a lista INTEIRA, não só o pedaço que coube na tela
    graves: achados.filter((a) => a.gravidade === "ALTA").length,
    total: achados.length,
    // brigas que JÁ acabaram: contam como tranquilidade, não como tarefa
    resolvidas: resolvidas.length,
    ultimaResolvida: resolvidas[0]?.quando ?? null,
  };
}

/**
 * O que cabe na tela: até 30 de CADA tipo — e SÓ isso.
 *
 * O teto era global (200) e a lista sai na ordem de consertar, então uma
 * categoria barulhenta no meio da fila empurrava as últimas para fora: a
 * lojista via "11× vínculo sem peça na Nuvemshop" no resumo sem NUNCA
 * descobrir quais peças eram (conferência da Entre Linhas, 19/08/2026).
 *
 * O teto global NÃO volta junto com o teto por tipo (achado da revisão): com
 * oito categorias cheias, 8×30 passa de 200 e a última — "estoque não bate",
 * a mais comum — sairia de novo com ZERO linhas na tela. Trinta de cada é
 * limite suficiente (no máximo 240 linhas), e o que sobra é CONTADO.
 */
export function recortarParaTela(achados: Achado[], porTipo = 30) {
  const vistos = new Map<TipoAchado, number>();
  const mostrados: Achado[] = [];
  let omitidos = 0;
  for (const a of achados) {
    const n = (vistos.get(a.tipo) ?? 0) + 1;
    vistos.set(a.tipo, n);
    if (n <= porTipo) mostrados.push(a);
    else omitidos++;
  }
  return { mostrados, omitidos };
}
