import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { canSeeAll } from "@/lib/scope";
import { meCalculate } from "@/lib/melhorenvio";
import { embalagensParecidas, pesoTotalKg } from "@/lib/envios/simulador";
import {
  lerMedidasPorCategoria,
  lerPesosPorCategoria,
  montarPacote,
  pesoDaCategoriaG,
} from "@/lib/envios/pacote";

/**
 * SIMULADOR DE FRETE (RN-019): a vendedora responde "quanto fica o frete?"
 * ANTES de o pedido existir — com a embalagem de um envio REAL parecido.
 *
 * GET  ?pecas=23 → envios passados com ~23 peças (a vendedora ESCOLHE um;
 *                  o sistema não chuta — regra combinada com o dono)
 * POST { cep, valorSegurado, volumes } → cotação no Melhor Envio
 *
 * Dupla trava: módulo Envios contratado E o interruptor do simulador ligado
 * pela loja. Cotar é livre (como na tela do pedido) — simular não mexe em
 * dinheiro nem compra nada.
 */

async function travas(companyId: string): Promise<NextResponse | null> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { shippingEnabled: true, freteSimuladorEnabled: true },
  });
  if (!company?.shippingEnabled)
    return NextResponse.json({ error: "Módulo Envios não contratado." }, { status: 403 });
  if (!company.freteSimuladorEnabled)
    return NextResponse.json(
      { error: "O simulador de frete está desligado. Ligue na tela Envios." },
      { status: 403 }
    );
  return null;
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const bloqueio = await travas(user.companyId);
    if (bloqueio) return bloqueio;
    // SEM ?pecas → devolve as categorias da loja (modo principal: montar o
    // pacote pelas medidas de 1 peça por categoria, RN-019)
    const pecasParam = req.nextUrl.searchParams.get("pecas");
    if (pecasParam === null) {
      const [conn, produtos] = await Promise.all([
        db.melhorEnvioConnection.findUnique({
          where: { companyId: user.companyId },
          select: { categoryDims: true, categoryWeights: true, defaultWeightGrams: true },
        }),
        db.product.findMany({
          // só produto ATIVO: categoria de produto desativado apareceria
          // eternamente "(sem medidas)" — e a tela de Configurações, que só
          // lista as ativas, nunca teria onde preencher
          where: { companyId: user.companyId, active: true },
          select: { category: true },
          distinct: ["category"],
          orderBy: { category: "asc" },
        }),
      ]);
      const medidas = lerMedidasPorCategoria(conn?.categoryDims ?? "");
      return NextResponse.json({
        categorias: produtos
          .map((p) => p.category)
          .filter(Boolean)
          .map((nome) => ({
            nome,
            // sem medidas cadastradas a categoria aparece desabilitada, com a
            // dica de preencher em Configurações → Melhor Envio
            temMedidas: Boolean(medidas[nome]),
          })),
      });
    }

    const pecas = Number(pecasParam);
    if (!Number.isInteger(pecas) || pecas < 1 || pecas > 10_000)
      return NextResponse.json({ error: "Informe o número de peças." }, { status: 400 });
    const embalagens = await embalagensParecidas(user.companyId, pecas);
    // A MEMÓRIA é da loja inteira (RN-019) — a caixa que serve é a mesma,
    // não importa quem vendeu. Mas a IDENTIDADE do pedido segue a RN-007:
    // vendedora sem visão total recebe só a embalagem (peças, medidas,
    // data), sem número nem id de pedido de colega.
    const vePedidos = canSeeAll(user) || Boolean(user.pedidosVisaoTotal);
    return NextResponse.json({
      embalagens: embalagens.map((e) => ({
        id: e.id,
        pedido: vePedidos ? e.orderNumber : null,
        compradoEm: e.compradoEm,
        pecas: e.pecas,
        volumes: e.volumes,
        pesoKg: e.pesoKg,
      })),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}

// mesmos tetos da tela do pedido (limites do Melhor Envio: 150 cm / 150 kg)
const cotarSchema = z.object({
  cep: z.string().transform((s) => s.replace(/\D/g, "")),
  valorSegurado: z.number().min(0).max(1_000_000),
  // OU a embalagem de um envio passado (volumes prontos)...
  volumes: z
    .array(
      z.object({
        pesoKg: z.number().positive().max(150),
        alturaCm: z.number().positive().max(150),
        larguraCm: z.number().positive().max(150),
        comprimentoCm: z.number().positive().max(150),
      })
    )
    .min(1)
    .max(8)
    .optional(),
  // ...OU as pilhas por categoria — o SERVIDOR monta o pacote (medida e peso
  // saem do cadastro da loja, nunca do navegador)
  categorias: z
    .array(
      z.object({
        categoria: z.string().min(1).max(80),
        quantidade: z.number().int().min(1).max(10_000),
      })
    )
    .min(1)
    .max(20)
    .optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const bloqueio = await travas(user.companyId);
    if (bloqueio) return bloqueio;
    const parsed = cotarSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success)
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    const { cep, valorSegurado, categorias } = parsed.data;
    if (cep.length !== 8)
      return NextResponse.json({ error: "CEP inválido — são 8 números." }, { status: 400 });
    if (!parsed.data.volumes && !categorias)
      return NextResponse.json(
        { error: "Informe as categorias ou escolha uma embalagem." },
        { status: 400 }
      );

    // modo por categorias: o pacote nasce AQUI, do cadastro da loja
    let volumes = parsed.data.volumes;
    if (!volumes && categorias) {
      const conn = await db.melhorEnvioConnection.findUnique({
        where: { companyId: user.companyId },
        select: { categoryDims: true, categoryWeights: true, defaultWeightGrams: true },
      });
      if (!conn)
        return NextResponse.json(
          { error: "Conecte o Melhor Envio em Configurações." },
          { status: 409 }
        );
      const medidas = lerMedidasPorCategoria(conn.categoryDims);
      const semMedidas = categorias
        .map((c) => c.categoria)
        .filter((nome) => !medidas[nome]);
      if (semMedidas.length > 0)
        return NextResponse.json(
          {
            error: `Falta cadastrar as medidas de: ${semMedidas.join(", ")}. Preencha em Configurações → Melhor Envio → Embalagem e peso por categoria.`,
          },
          { status: 409 }
        );
      const pesos = lerPesosPorCategoria(conn.categoryWeights);
      const gramas = categorias.reduce(
        (s, c) =>
          s + c.quantidade * pesoDaCategoriaG(c.categoria, pesos, conn.defaultWeightGrams),
        0
      );
      const pesoKg = Math.max(0.05, Math.round(gramas) / 1000);
      const pacote = montarPacote(categorias, medidas, pesoKg);
      if (!pacote)
        return NextResponse.json(
          { error: "Pedido grande demais para simular — acima de 8 volumes." },
          { status: 409 }
        );
      volumes = pacote;
    }

    const r = await meCalculate({
      companyId: user.companyId,
      toZip: cep,
      weightKg: pesoTotalKg(volumes!),
      insuranceValue: valorSegurado,
      volumes,
    });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 502 });
    return NextResponse.json({
      quotes: r.quotes,
      recusadas: r.recusadas,
      // o pacote que a simulação usou — a tela mostra ("2,4 kg · 30×20×46")
      pacote: volumes,
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
