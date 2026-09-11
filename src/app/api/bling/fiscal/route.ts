import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { podeOperarIntegracoes } from "@/lib/scope";
import { db } from "@/lib/db";
import { digitosDoNcm, ncmValido, origemValida } from "@/lib/fiscal-ncm";

/**
 * RN-055 + RN-054 · A configuração FISCAL da loja: NCM por categoria, NCM
 * padrão, origem da mercadoria e as duas naturezas de operação.
 *
 * Quem mexe é quem opera integrações (`podeOperarIntegracoes`) — é
 * configuração que decide o conteúdo de DOCUMENTO FISCAL, não ajuste de tela.
 * O servidor é a segunda tranca: NCM inválido é recusado aqui mesmo que a
 * tela deixe passar, porque número torto vira nota recusada pela SEFAZ.
 */

export const dynamic = "force-dynamic";

const schema = z.object({
  /** NCM de cada categoria; string vazia APAGA o cadastro daquela categoria */
  categorias: z.record(z.string(), z.string()).optional(),
  ncmPadrao: z.string().optional(),
  origemMercadoria: z.coerce.number().int().optional(),
  /**
   * ID da natureza no Bling, como TEXTO (é o que o Bling usa, e os ids de lá
   * passam de 10 dígitos). String vazia = a loja APAGOU o cadastro e volta a
   * usar a natureza padrão da conta dela no Bling.
   *
   * Aceitar número aqui já custou caro: com `z.coerce.number()`, o campo em
   * branco virava `0` (`Number("") === 0`) — a loja salvava só os NCMs e toda
   * nota dela passava a sair com `naturezaOperacao: { id: 0 }`, sem jeito de
   * desfazer. Texto de dígitos não tem essa armadilha.
   */
  naturezaContribuinteId: z.string().optional(),
  naturezaNaoContribuinteId: z.string().optional(),
});

/** Só dígitos; vazio vira null (= apagar o cadastro). */
function idDaNatureza(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const d = v.replace(/\D/g, "");
  return d || null;
}

/** O que a tela precisa para desenhar: as categorias da loja e o que já vale. */
export async function GET() {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const [conf, categorias, cadastradas] = await Promise.all([
      db.blingConnection.findUnique({
        where: { companyId: user.companyId },
        select: {
          ncmPadrao: true,
          origemMercadoria: true,
          naturezaContribuinteId: true,
          naturezaNaoContribuinteId: true,
        },
      }),
      // as categorias que a loja REALMENTE usa (é por elas que o NCM entra)
      // TODA categoria com produto, ativo ou não: o aviso da ficha do pedido
      // cobra a categoria da peça que está no pedido, e peça pausada continua
      // saindo em nota. Listar só as ativas mandava a loja cadastrar uma
      // categoria que a tela não mostrava.
      db.product.findMany({
        where: { companyId: user.companyId },
        select: { category: true },
        distinct: ["category"],
        orderBy: { category: "asc" },
      }),
      db.fiscalCategoria.findMany({
        where: { companyId: user.companyId },
        select: { category: true, ncm: true },
      }),
    ]);
    return NextResponse.json({
      conectado: Boolean(conf),
      ncmPadrao: conf?.ncmPadrao ?? "",
      origemMercadoria: conf?.origemMercadoria ?? 0,
      naturezaContribuinteId: conf?.naturezaContribuinteId ?? "",
      naturezaNaoContribuinteId: conf?.naturezaNaoContribuinteId ?? "",
      categorias: categorias.map((c) => c.category).filter(Boolean),
      ncmPorCategoria: Object.fromEntries(cadastradas.map((c) => [c.category, c.ncm])),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser();
    if (!podeOperarIntegracoes(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    const d = parsed.data;

    // a loja precisa estar conectada: a configuração mora na conexão, e sem
    // ela não há nota para configurar
    const conn = await db.blingConnection.findUnique({
      where: { companyId: user.companyId },
      select: { id: true },
    });
    if (!conn) {
      return NextResponse.json(
        { error: "Conecte o Bling antes de configurar a parte fiscal." },
        { status: 400 }
      );
    }

    // NCM inválido é RECUSADO com frase — a SEFAZ recusaria depois, e ali a
    // mensagem não ensina nada a ninguém
    if (d.ncmPadrao && d.ncmPadrao.trim() && !ncmValido(d.ncmPadrao)) {
      return NextResponse.json(
        { error: "O NCM padrão precisa ter 8 dígitos (ex.: 6109.10.00)." },
        { status: 400 }
      );
    }
    for (const [categoria, ncm] of Object.entries(d.categorias ?? {})) {
      if (ncm.trim() && !ncmValido(ncm)) {
        return NextResponse.json(
          { error: `O NCM da categoria "${categoria}" precisa ter 8 dígitos.` },
          { status: 400 }
        );
      }
    }

    await db.$transaction(async (tx) => {
      await tx.blingConnection.update({
        where: { companyId: user.companyId },
        data: {
          ...(d.ncmPadrao !== undefined
            ? { ncmPadrao: digitosDoNcm(d.ncmPadrao) || null }
            : {}),
          ...(d.origemMercadoria !== undefined
            ? { origemMercadoria: origemValida(d.origemMercadoria) }
            : {}),
          ...(d.naturezaContribuinteId !== undefined
            ? { naturezaContribuinteId: idDaNatureza(d.naturezaContribuinteId) ?? null }
            : {}),
          ...(d.naturezaNaoContribuinteId !== undefined
            ? { naturezaNaoContribuinteId: idDaNatureza(d.naturezaNaoContribuinteId) ?? null }
            : {}),
        },
      });
      for (const [categoria, ncm] of Object.entries(d.categorias ?? {})) {
        const digitos = digitosDoNcm(ncm);
        if (!digitos) {
          // campo apagado = a categoria volta a herdar o NCM da loja
          await tx.fiscalCategoria.deleteMany({
            where: { companyId: user.companyId, category: categoria },
          });
          continue;
        }
        await tx.fiscalCategoria.upsert({
          where: { companyId_category: { companyId: user.companyId, category: categoria } },
          create: { companyId: user.companyId, category: categoria, ncm: digitos },
          update: { ncm: digitos },
        });
      }
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
