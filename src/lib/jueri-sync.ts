import { db } from "./db";
import { decryptSecret } from "./crypto";
import { logServerError } from "./health";
import {
  jueriGet,
  extrairPrecos,
  extrairFotos,
  montarSku,
  type JueriProduto,
} from "./jueri";

/**
 * Motor de sincronização do catálogo Jueri — UMA PÁGINA por chamada.
 *
 * Compartilhado entre o botão da tela (Configurações → Jueri, que chama
 * página a página com barra de progresso) e o cron automático 2x/dia, que
 * roda para todas as lojas conectadas sem precisar de ninguém logado.
 *
 * simular=true: NADA é gravado — só o relatório do que aconteceria.
 *
 * RN-077 (09/10/2026, relato do dono: "a cliente mudou as fotos lá na Jueri
 * e não atualiza; ela vende na Jueri e o estoque aqui não muda"). O cartão
 * dizia "última importação 06/10, 11:13" — horário de clique, não de cron
 * (03:00 e 12:00). Três defeitos no automático: (1) as FOTOS nunca eram
 * atualizadas depois da primeira importação, por regra escrita aqui;
 * (2) o cron não tinha orçamento de tempo — um catálogo grande morria no
 * corte da Vercel sem gravar `lastSyncAt`, e a loja "mais atrasada" ia
 * primeiro na rodada seguinte para morrer no mesmo lugar; (3) nada ficava
 * registrado: o resultado voltava num JSON que ninguém lê. Agora as fotos
 * da Jueri acompanham (as da loja ficam), a página custa uma consulta em
 * vez de quarenta, o cron para por conta própria antes do corte e RETOMA
 * da página onde parou, e cada rodada deixa rastro no cartão, na Central
 * de Comunicação e na Saúde.
 */

export type JueriResumo = {
  processados: number;
  novos: number;
  atualizados: number;
  ignorados: number;
  comFoto: number;
  semFoto: number;
  coresNovas: number;
  /** produtos cujas fotos da Jueri mudaram e foram trocadas aqui (RN-077) */
  fotosTrocadas: number;
};

export const zerarResumo = (): JueriResumo => ({
  processados: 0,
  novos: 0,
  atualizados: 0,
  ignorados: 0,
  comFoto: 0,
  semFoto: 0,
  coresNovas: 0,
  fotosTrocadas: 0,
});

export type JueriPageResult =
  | {
      ok: true;
      temMais: boolean;
      resumo: JueriResumo;
      exemplos: { descricao: string; sku: string; acao: string }[];
    }
  | { ok: false; status: number; error: string };

const POR_PAGINA = 40;

/** Tipo de evento do rastro de cada rodada automática (Central de Comunicação). */
export const TIPO_SYNC_JUERI = "jueri.sync";

/** Marca da foto que veio da Jueri (`ProductImage.source`). */
export const ORIGEM_JUERI = "JUERI";

export type DecisaoDeFotos = {
  /** a lista da Jueri a anotar no produto (`Product.jueriFotos`) */
  lista: string[];
  apagarIds: string[];
  criar: { url: string; order: number }[];
  /** fotos da loja que mudam de posição para as da Jueri entrarem no lugar das antigas */
  reordenar: { id: string; order: number }[];
};

/**
 * FOTOS ACOMPANHAM A JUERI (RN-077).
 *
 * A foto da Jueri carrega a marca `source = "JUERI"`; a que a loja subiu
 * (ou a que veio da Nuvemshop, que também é link) não. E o produto guarda a
 * LISTA da Jueri na última sincronização: só quando a Jueri MUDA a lista
 * (foto nova, foto tirada, ordem) as fotos marcadas são trocadas pelas de
 * agora, no lugar em que as antigas estavam — a foto que a loja subiu fica
 * onde estava, e o que a loja fez nas fotos da Jueri entre uma rodada e
 * outra (tirou uma ruim, mudou a capa) fica até a Jueri mudar de novo.
 * Produto que nunca sincronizou fotos: sem foto nenhuma, ganha as da Jueri;
 * com fotos de outra origem, nada é tocado — só a lista é anotada.
 * Devolve `null` quando não há nada a fazer nem a anotar.
 */
export function decidirFotos(
  existentes: { id: string; order: number; source: string | null }[],
  ultimaLista: string[] | null,
  fotosJueri: string[]
): DecisaoDeFotos | null {
  if (ultimaLista === null) {
    if (existentes.length > 0) {
      return { lista: fotosJueri, apagarIds: [], criar: [], reordenar: [] };
    }
    return {
      lista: fotosJueri,
      apagarIds: [],
      criar: fotosJueri.map((url, i) => ({ url, order: i })),
      reordenar: [],
    };
  }
  const iguais =
    ultimaLista.length === fotosJueri.length && ultimaLista.every((u, i) => u === fotosJueri[i]);
  if (iguais) return null;
  const ordenadas = [...existentes].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const daJueri = ordenadas.filter((i) => i.source === ORIGEM_JUERI);
  const daLoja = ordenadas.filter((i) => i.source !== ORIGEM_JUERI);
  // as novas entram onde a PRIMEIRA da Jueri estava (sem nenhuma, no fim)
  const primeira = ordenadas.findIndex((i) => i.source === ORIGEM_JUERI);
  const antesDaJueri =
    primeira < 0 ? daLoja.length : ordenadas.slice(0, primeira).filter((i) => i.source !== ORIGEM_JUERI).length;
  const sequencia: ({ id: string; order: number } | { url: string })[] = [
    ...daLoja.slice(0, antesDaJueri),
    ...fotosJueri.map((url) => ({ url })),
    ...daLoja.slice(antesDaJueri),
  ];
  const criar: { url: string; order: number }[] = [];
  const reordenar: { id: string; order: number }[] = [];
  sequencia.forEach((item, order) => {
    if ("url" in item) criar.push({ url: item.url, order });
    else if (item.order !== order) reordenar.push({ id: item.id, order });
  });
  return { lista: fotosJueri, apagarIds: daJueri.map((i) => i.id), criar, reordenar };
}

/** A lista anotada no produto, tolerando lixo (é JSON gravado por nós, mas é texto). */
export function lerListaDeFotos(bruto: string | null | undefined): string[] | null {
  if (!bruto) return null;
  try {
    const v = JSON.parse(bruto);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

/** O que a Jueri manda e o produto já tem igual não vai ao banco (uma página são 40 produtos). */
export function produtoMudou(
  existente: {
    jueriId: string | null;
    wholesalePrice: number;
    retailPrice: number;
    costPrice: number;
    active: boolean;
  },
  novo: { jueriId: string; atacado: number; varejo: number; custo: number; ativo: boolean }
): boolean {
  return (
    existente.jueriId !== novo.jueriId ||
    existente.wholesalePrice !== novo.atacado ||
    existente.retailPrice !== novo.varejo ||
    existente.costPrice !== novo.custo ||
    existente.active !== novo.ativo
  );
}

export async function syncJueriPage(
  companyId: string,
  pagina: number,
  simular: boolean
): Promise<JueriPageResult> {
  const conn = await db.jueriConnection.findUnique({ where: { companyId } });
  if (!conn) return { ok: false, status: 409, error: "Jueri não conectada." };
  // token guardado criptografado (conexão antiga em texto puro passa direto)
  const token = decryptSecret(conn.token);
  const p = (rota: string) => `/${conn.clienteSistema}${rota}`;

  // categorias: id → nome (uma consulta por página é barato e simples)
  const catRes = await jueriGet(token, p("/produto/categoria"));
  const categorias = new Map<number, string>(
    Array.isArray(catRes.body)
      ? (catRes.body as { id: number; nome: string }[]).map((c) => [c.id, c.nome])
      : []
  );

  const lista = await jueriGet(
    token,
    p(`/produto?per_page=${POR_PAGINA}&page=${pagina}`)
  );
  const body = lista.body as {
    data?: JueriProduto[];
    next_page_url?: string | null;
  } | null;
  if (lista.status !== 200 || !Array.isArray(body?.data)) {
    return {
      ok: false,
      status: 502,
      error: `A Jueri não retornou os produtos (HTTP ${lista.status}).`,
    };
  }
  const produtos = body!.data!;
  const temMais = Boolean(body!.next_page_url);

  const resumo = zerarResumo();
  const exemplos: { descricao: string; sku: string; acao: string }[] = [];
  const coresContadas = new Set<string>(); // evita contar a mesma cor 2x na página

  // UMA consulta para a página inteira (eram 40 `findFirst`, e com o banco
  // em outra região cada ida custa ~100 ms — era isso que estourava o
  // tempo do cron).
  const lidos = produtos.map((prod) => ({ jueriId: String(prod.id), sku: montarSku(prod) }));
  const existentes = await db.product.findMany({
    where: {
      companyId,
      OR: [
        { jueriId: { in: lidos.map((l) => l.jueriId) } },
        { sku: { in: lidos.map((l) => l.sku) } },
      ],
    },
    include: {
      variants: true,
      // só id, ordem e origem: a foto da loja é data-URL e pesa megabytes
      images: { select: { id: true, order: true, source: true } },
    },
  });
  type Existente = (typeof existentes)[number];
  const porJueriId = new Map(existentes.filter((e) => e.jueriId).map((e) => [e.jueriId!, e]));
  const porSku = new Map(existentes.map((e) => [e.sku, e]));

  for (const prod of produtos) {
    resumo.processados += 1;
    const sku = montarSku(prod);
    const { varejo, atacado } = extrairPrecos(prod);
    const fotos = extrairFotos(prod);
    const ativo = prod.fk_status_id !== 2;
    const estoque = Math.max(0, Math.trunc(Number(prod.quantidade ?? 0) || 0));
    const custo = Number(prod.custo_total ?? prod.custo_compra_bruto ?? 0) || 0;
    const nome = (prod.descricao ?? `Produto ${prod.id}`).toString().slice(0, 120);
    const categoria =
      (prod.fk_categoria_id != null ? categorias.get(prod.fk_categoria_id) : null) ??
      "Geral";
    const cor = (prod.cor ?? "").toString().trim();
    const jueriId = String(prod.id);

    if (fotos.length > 0) resumo.comFoto += 1;
    else resumo.semFoto += 1;

    // o vínculo pelo id da Jueri vence; o SKU é o caminho da primeira vez
    const existente = porJueriId.get(jueriId) ?? porSku.get(sku) ?? null;

    if (!existente && !ativo) {
      resumo.ignorados += 1;
      continue;
    }

    if (!existente) {
      resumo.novos += 1;
      if (exemplos.length < 5) exemplos.push({ descricao: nome, sku, acao: "criar" });
      if (!simular) {
        const criado = await db.product.create({
          data: {
            companyId,
            name: nome,
            sku,
            jueriId,
            category: categoria,
            description: (prod.descricao_completa ?? null) || null,
            costPrice: custo,
            wholesalePrice: atacado,
            retailPrice: varejo,
            active: ativo,
            images: { create: fotos.map((url, i) => ({ url, order: i, source: ORIGEM_JUERI })) },
            jueriFotos: JSON.stringify(fotos),
            variants: {
              create: [{ color: cor, size: "Único", stock: estoque, sku }],
            },
          },
          include: { variants: true, images: { select: { id: true, order: true, source: true } } },
        });
        // a Jueri repete a referência entre cores: o segundo produto da MESMA
        // página com este SKU acha o recém-criado e segue pelo caminho de
        // atualização, em vez de estourar o único (companyId, sku) e travar a
        // página — e a rodada — para sempre (achado da revisão)
        const comoExistente: Existente = criado;
        porSku.set(sku, comoExistente);
        porJueriId.set(jueriId, comoExistente);
        if (estoque > 0) {
          await db.inventoryMovement.create({
            data: {
              companyId,
              variantId: criado.variants[0].id,
              type: "ENTRADA",
              quantity: estoque,
              reason: "Importação Jueri",
            },
          });
        }
      }
    } else {
      resumo.atualizados += 1;
      if (exemplos.length < 5) exemplos.push({ descricao: nome, sku, acao: "atualizar" });
      // FOTOS (RN-077): as da Jueri acompanham a Jueri; as da loja ficam
      const fotosAFazer = decidirFotos(existente.images, lerListaDeFotos(existente.jueriFotos), fotos);
      const trocaFotos = !!fotosAFazer && (fotosAFazer.apagarIds.length > 0 || fotosAFazer.criar.length > 0);
      if (trocaFotos) resumo.fotosTrocadas += 1;
      if (!simular) {
        const mudou = produtoMudou(existente, { jueriId, atacado, varejo, custo, ativo });
        if (mudou || fotosAFazer) {
          await db.product.update({
            where: { id: existente.id },
            data: {
              // nome e categoria NÃO são sobrescritos no produto que já existe:
              // a loja organiza o catálogo aqui (organizador de categorias,
              // nome ajustado) e o sync 2x/dia desfazia todo o trabalho
              // (auditoria 07/08/2026). Preço, custo, estoque e ativo/inativo
              // continuam vindo da Jueri — ela é a dona desses números.
              jueriId,
              wholesalePrice: atacado,
              retailPrice: varejo,
              costPrice: custo,
              active: ativo,
              ...(fotosAFazer
                ? {
                    jueriFotos: JSON.stringify(fotosAFazer.lista),
                    images: {
                      deleteMany: { id: { in: fotosAFazer.apagarIds } },
                      create: fotosAFazer.criar.map((f) => ({ ...f, source: ORIGEM_JUERI })),
                    },
                  }
                : {}),
            },
          });
          for (const r of fotosAFazer?.reordenar ?? []) {
            await db.productImage.updateMany({
              where: { id: r.id, productId: existente.id },
              data: { order: r.order },
            });
          }
        }
        const variante = existente.variants[0];
        if (variante && variante.stock !== estoque) {
          await db.productVariant.update({
            where: { id: variante.id },
            data: { stock: estoque },
          });
          await db.inventoryMovement.create({
            data: {
              companyId,
              variantId: variante.id,
              type: "AJUSTE",
              quantity: Math.abs(estoque - variante.stock),
              reason: `Sincronização Jueri (${variante.stock} → ${estoque})`,
            },
          });
        }
      }
    }

    // biblioteca de cores: cria a cor com o hexadecimal que veio da Jueri
    if (cor && prod.cor_hexadecimal && /^#?[0-9a-fA-F]{6}$/.test(prod.cor_hexadecimal)) {
      const hex = prod.cor_hexadecimal.startsWith("#")
        ? prod.cor_hexadecimal
        : `#${prod.cor_hexadecimal}`;
      const jaTem =
        coresContadas.has(cor) ||
        (await db.companyColor.findUnique({
          where: { companyId_name: { companyId, name: cor } },
        }));
      coresContadas.add(cor);
      if (!jaTem) {
        resumo.coresNovas += 1;
        if (!simular) {
          await db.companyColor.create({
            data: { companyId, name: cor, hex },
          });
        }
      }
    }
  }

  if (!simular && !temMais) {
    await db.jueriConnection.update({
      where: { companyId },
      data: { lastSyncAt: new Date(), lastSyncPagina: null, lastSyncErro: null },
    });
  }

  return { ok: true, temMais, resumo, exemplos };
}

export type ResultadoDaLoja = {
  ok: boolean;
  resumo: JueriResumo;
  error?: string;
  /** parou por falta de tempo: a página seguinte fica para a próxima rodada */
  parcial?: boolean;
  /** a página em que a próxima rodada deve começar (parcial ou erro) */
  proximaPagina?: number;
  /** a última página processada nesta rodada */
  ultimaPagina?: number;
};

/**
 * Sincroniza as páginas de uma loja (usado pelo cron automático), somando o
 * resumo página a página. `maxPaginas` é uma trava de segurança.
 *
 * Página que falha ganha UMA nova tentativa (a API da Jueri soluça): um
 * tropeço na página 7 não aborta o resto em silêncio — as páginas já
 * gravadas ficam (o sync é idempotente). Se falhar de novo, devolve o erro
 * DIZENDO a página, e `lastSyncAt` não é marcado.
 *
 * ORÇAMENTO DE TEMPO (RN-077): `prazo` é o instante em que a rodada tem
 * que parar; a loja grande para por conta própria entre uma página e outra
 * e devolve `parcial` com a página seguinte — a próxima rodada começa de
 * lá (`paginaInicial`), em vez de recomeçar da primeira e morrer no mesmo
 * lugar. Sempre pelo menos uma página por rodada, senão a loja nunca anda.
 */
export async function syncJueriCompany(
  companyId: string,
  opcoes: {
    maxPaginas?: number;
    prazo?: number;
    paginaInicial?: number;
    sincronizarPagina?: (companyId: string, pagina: number) => Promise<JueriPageResult>;
  } = {}
): Promise<ResultadoDaLoja> {
  const maxPaginas = opcoes.maxPaginas ?? 500;
  const sincronizar =
    opcoes.sincronizarPagina ?? ((c: string, pg: number) => syncJueriPage(c, pg, false));
  const total = zerarResumo();
  let pagina = Math.max(1, opcoes.paginaInicial ?? 1);
  let ultimaPagina: number | undefined;
  for (;;) {
    let out = await sincronizar(companyId, pagina);
    if (!out.ok) out = await sincronizar(companyId, pagina);
    if (!out.ok) {
      return {
        ok: false,
        resumo: total,
        error: `${out.error} (parou na página ${pagina}; o que veio antes foi gravado)`,
        proximaPagina: pagina,
        ultimaPagina,
      };
    }
    ultimaPagina = pagina;
    for (const k of Object.keys(total) as (keyof JueriResumo)[]) {
      total[k] += out.resumo[k];
    }
    if (!out.temMais) return { ok: true, resumo: total, ultimaPagina };
    pagina += 1;
    if (pagina > maxPaginas) return { ok: true, resumo: total, ultimaPagina };
    if (opcoes.prazo != null && Date.now() >= opcoes.prazo) {
      return { ok: true, parcial: true, resumo: total, proximaPagina: pagina, ultimaPagina };
    }
  }
}

/**
 * A rodada AUTOMÁTICA de uma loja, com rastro (RN-077): retoma da página em
 * que a rodada anterior parou, grava no cartão da conexão a tentativa, o
 * erro e a página pendente, e deixa uma linha na Central de Comunicação da
 * loja — e, quando falha, uma no painel de Saúde. Nunca lança: a fila do
 * cron continua para a loja seguinte.
 */
export async function rodarSyncJueriDoCron(
  companyId: string,
  prazo: number
): Promise<ResultadoDaLoja> {
  const conn = await db.jueriConnection.findUnique({
    where: { companyId },
    select: { lastSyncPagina: true, company: { select: { name: true } } },
  });
  const agora = new Date();
  const paginaInicial = conn?.lastSyncPagina ?? 1;
  let out: ResultadoDaLoja;
  try {
    out = await syncJueriCompany(companyId, { prazo, paginaInicial });
  } catch (e) {
    out = {
      ok: false,
      resumo: zerarResumo(),
      error: (e instanceof Error ? e.message : "falha") + ` (parou na página ${paginaInicial})`,
      proximaPagina: paginaInicial,
    };
  }
  const r = out.resumo;
  const contagem =
    `${r.processados} produto(s) lido(s): ${r.novos} novo(s), ${r.atualizados} atualizado(s), ` +
    `${r.fotosTrocadas} com fotos trocadas, ${r.ignorados} ignorado(s)`;
  const paginas =
    out.ultimaPagina != null
      ? paginaInicial === out.ultimaPagina
        ? `página ${paginaInicial}`
        : `páginas ${paginaInicial} a ${out.ultimaPagina}`
      : `a partir da página ${paginaInicial}`;
  const texto = !out.ok
    ? `Sincronização automática da Jueri FALHOU (${paginas}): ${out.error}. ${contagem}. A próxima rodada tenta de novo da página ${out.proximaPagina ?? paginaInicial}.`
    : out.parcial
      ? `Sincronização automática da Jueri em etapas (${paginas}): o tempo da rodada acabou e a próxima continua da página ${out.proximaPagina}. ${contagem}.`
      : `Sincronização automática da Jueri concluída (${paginas}). ${contagem}.`;
  try {
    await db.jueriConnection.update({
      where: { companyId },
      data: {
        lastSyncTentativaEm: agora,
        lastSyncPagina: out.ok && !out.parcial ? null : (out.proximaPagina ?? paginaInicial),
        lastSyncErro: out.ok ? null : (out.error ?? "falha").slice(0, 500),
      },
    });
  } catch {
    // o rastro não pode derrubar a fila
  }
  await db.commEvent
    .create({
      data: {
        companyId,
        direction: "IN",
        type: TIPO_SYNC_JUERI,
        status: out.ok ? "OK" : "ERRO",
        error: out.ok ? null : texto.slice(0, 2000),
        response: out.ok ? texto.slice(0, 2000) : null,
      },
    })
    .catch(() => null);
  if (!out.ok) {
    await logServerError({
      source: "server",
      path: "GET /api/cron/jueri-sync",
      message: `Jueri: sincronização automática falhou em ${conn?.company.name ?? companyId}`,
      detail: `loja ${companyId} (${conn?.company.name ?? "?"})\n${texto}`.slice(0, 4000),
      // duas rodadas por dia com o mesmo token vencido não podem calar o
      // alarme das emergências por 15 min a cada vez (régua da RN-066); o
      // caso aparece na lista e na conta da Saúde, no cartão e na Central
      alarme: false,
    });
  }
  return out;
}
