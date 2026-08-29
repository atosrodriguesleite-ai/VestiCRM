import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { CustomerType } from "@prisma/client";
import { requireUser, AuthError } from "@/lib/auth";
import { isSupport } from "@/lib/scope";
import { evaluateSegment } from "@/lib/segments";

/**
 * `nullish()` em tudo, e não `optional()`: a tela manda `Number(texto)` no
 * campo de dinheiro, e "1.500,00" vira NaN — que o JSON entrega como `null`.
 * Com `optional()` puro a prévia respondia 400, a tela engolia o erro (o
 * `if (res.ok)` não trata) e a contagem de alcance CONGELAVA num número
 * velho: a lojista dispararia a campanha achando que atinge outra gente.
 * Campo vazio/ilegível = filtro não aplicado, que é o que ela espera ver.
 */
const opcional = <T extends z.ZodTypeAny>(t: T) => t.nullish();

const schema = z.object({
  inactiveDays: opcional(z.number().int().min(1).max(3650)),
  // Direto do enum do Prisma: a lista copiada à mão envelhece calada — tipo
  // de cliente novo aparece sozinho no seletor da tela (que lê o enum) e o
  // molde recusaria, devolvendo a MESMA prévia velha que este molde veio
  // impedir.
  type: opcional(z.enum(CustomerType)),
  city: opcional(z.string().max(80)),
  minSpent: opcional(z.number().min(0).max(100_000_000)),
  interest: opcional(z.string().max(80)),
  tag: opcional(z.string().max(80)),
  lostDeals: opcional(z.boolean()),
});

/** Retorna quantos (e quais) clientes um filtro de campanha alcança. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    // Suporte não mexe em campanhas (a tela já bloqueia; a API não)
    if (isSupport(user)) {
      return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
    }
    // O `as SegmentFilter` de antes era promessa, não conferência: o
    // TypeScript some na hora de rodar e o que chegasse ia inteiro para o
    // motor de segmento. Com o molde, campo estranho não entra e número
    // absurdo (dias negativos, gasto gigante) não vira consulta pesada.
    const parsed = schema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "Filtro inválido" }, { status: 400 });
    }
    // `null` vira ausência — o motor de segmento lê campo por campo
    const filtro = Object.fromEntries(
      Object.entries(parsed.data).filter(([, v]) => v !== null && v !== undefined)
    );
    const customers = await evaluateSegment(user, filtro);
    return NextResponse.json({
      count: customers.length,
      sample: customers.slice(0, 8),
    });
  } catch (e) {
    if (e instanceof AuthError)
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    throw e;
  }
}
