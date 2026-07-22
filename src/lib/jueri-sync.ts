import { db } from "./db";
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
 */

export type JueriResumo = {
  processados: number;
  novos: number;
  atualizados: number;
  ignorados: number;
  comFoto: number;
  semFoto: number;
  coresNovas: number;
};

export const zerarResumo = (): JueriResumo => ({
  processados: 0,
  novos: 0,
  atualizados: 0,
  ignorados: 0,
  comFoto: 0,
  semFoto: 0,
  coresNovas: 0,
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

export async function syncJueriPage(
  companyId: string,
  pagina: number,
  simular: boolean
): Promise<JueriPageResult> {
  const conn = await db.jueriConnection.findUnique({ where: { companyId } });
  if (!conn) return { ok: false, status: 409, error: "Jueri não conectada." };
  const p = (rota: string) => `/${conn.clienteSistema}${rota}`;

  // categorias: id → nome (uma consulta por página é barato e simples)
  const catRes = await jueriGet(conn.token, p("/produto/categoria"));
  const categorias = new Map<number, string>(
    Array.isArray(catRes.body)
      ? (catRes.body as { id: number; nome: string }[]).map((c) => [c.id, c.nome])
      : []
  );

  const lista = await jueriGet(
    conn.token,
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

  for (const prod of produtos) {
    resumo.processados += 1;
    const sku = montarSku(prod);
    const { varejo, atacado } = extrairPrecos(prod);
    const fotos = extrairFotos(prod);
    const ativo = prod.fk_status_id !== 2;
    const estoque = Math.max(0, Math.trunc(Number(prod.quantidade ?? 0) || 0));
    const nome = (prod.descricao ?? `Produto ${prod.id}`).toString().slice(0, 120);
    const categoria =
      (prod.fk_categoria_id != null ? categorias.get(prod.fk_categoria_id) : null) ??
      "Geral";
    const cor = (prod.cor ?? "").toString().trim();
    const jueriId = String(prod.id);

    if (fotos.length > 0) resumo.comFoto += 1;
    else resumo.semFoto += 1;

    const existente = await db.product.findFirst({
      where: {
        companyId,
        OR: [{ jueriId }, { sku }],
      },
      include: { variants: true, images: { select: { id: true } } },
    });

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
            costPrice: Number(prod.custo_total ?? prod.custo_compra_bruto ?? 0) || 0,
            wholesalePrice: atacado,
            retailPrice: varejo,
            active: ativo,
            images: { create: fotos.map((url, i) => ({ url, order: i })) },
            variants: {
              create: [{ color: cor, size: "Único", stock: estoque, sku }],
            },
          },
          include: { variants: true },
        });
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
      if (!simular) {
        await db.product.update({
          where: { id: existente.id },
          data: {
            name: nome,
            jueriId,
            category: categoria,
            wholesalePrice: atacado,
            retailPrice: varejo,
            costPrice: Number(prod.custo_total ?? prod.custo_compra_bruto ?? 0) || 0,
            active: ativo,
            // fotos: só preenche se o produto ainda não tem nenhuma —
            // nunca sobrescreve fotos que a loja já cuidou aqui
            ...(existente.images.length === 0 && fotos.length > 0
              ? { images: { create: fotos.map((url, i) => ({ url, order: i })) } }
              : {}),
          },
        });
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
      data: { lastSyncAt: new Date() },
    });
  }

  return { ok: true, temMais, resumo, exemplos };
}

/**
 * Sincroniza TODAS as páginas de uma loja (usado pelo cron automático).
 * Soma o resumo página a página. `maxPaginas` é uma trava de segurança.
 */
export async function syncJueriCompany(
  companyId: string,
  maxPaginas = 500
): Promise<{ ok: boolean; resumo: JueriResumo; error?: string }> {
  const total = zerarResumo();
  let pagina = 1;
  for (;;) {
    const out = await syncJueriPage(companyId, pagina, false);
    if (!out.ok) return { ok: false, resumo: total, error: out.error };
    for (const k of Object.keys(total) as (keyof JueriResumo)[]) {
      total[k] += out.resumo[k];
    }
    if (!out.temMais) return { ok: true, resumo: total };
    pagina += 1;
    if (pagina > maxPaginas) return { ok: true, resumo: total };
  }
}
