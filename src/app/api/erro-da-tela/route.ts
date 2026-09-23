import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser, AuthError } from "@/lib/auth";
import { db } from "@/lib/db";
import { logServerError } from "@/lib/health";
import {
  chavesDoRelatoDeErro,
  registrarTentativa,
  segundosDeBloqueio,
} from "@/lib/rate-limit";
import {
  FONTE_TELA_VERSAO_VELHA,
  MS_VALIDADE_DO_RELATO,
  relatoEsperado,
  soOCaminho,
  TETO_CAMINHO,
  TETO_DETALHE,
  TETO_MENSAGEM,
} from "@/lib/erro-da-tela";

export const dynamic = "force-dynamic";

/**
 * RN-065 · O relato da tela que quebrou no navegador, levado ao painel de
 * Saúde (`ErrorLog`, fonte "client" — ela já existia no coletor e nunca
 * tinha tido quem a usasse).
 *
 * Só com login: o aparelho guarda o relato e só o manda quando a pessoa
 * está dentro do app (`EnviarRelatoDeErro`). Assim a quebra de quem estava
 * com a sessão vencida chega DEPOIS do login, e esta porta não vira uma
 * porta pública de escrita no banco.
 *
 * O texto vem do aparelho, então é tratado como o que é: tamanho limitado
 * aqui de novo, caminho limpo de novo (sem busca, sem `#`), ritmo por
 * pessoa, e ele NÃO toca o alarme "🚨 Erro em produção" (ver `alarme` em
 * `logServerError`): fica no painel, na conta de erros, com a loja e a
 * pessoa que o mandaram. Quem é a pessoa e a loja vem da SESSÃO, nunca do
 * corpo. O mesmo relato (mesmo `id`) não é gravado duas vezes: o aparelho
 * reenvia quando a resposta se perdeu numa recarga.
 *
 * "Versão velha" que DE FATO recarregou é o esperado depois de cada
 * entrega: fonte própria, fora da conta. A que a trava barrou é peça
 * faltando de verdade e entra como quebra.
 */
const relatoSchema = z.object({
  id: z.string().min(8).max(64),
  mensagem: z.string().min(1).max(TETO_MENSAGEM),
  detalhe: z.string().max(TETO_DETALHE).nullable(),
  caminho: z.string().max(TETO_CAMINHO),
  versaoVelha: z.boolean(),
  recarregouSozinho: z.boolean(),
  quando: z.string().max(40),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();

    // o ritmo conta ANTES de ler o corpo (a régua do login): relato torto
    // repetido também gasta a cota
    const chaves = chavesDoRelatoDeErro(user.id);
    if (await segundosDeBloqueio(chaves)) {
      return NextResponse.json({ error: "Muitos relatos seguidos" }, { status: 429 });
    }
    await registrarTentativa(chaves);

    const parsed = relatoSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: "Relato inválido" }, { status: 400 });
    }
    const r = parsed.data;
    const navegador = (req.headers.get("user-agent") ?? "").slice(0, 200);
    const marcaDoRelato = `relato: ${r.id}`;

    // já gravado (a resposta se perdeu numa recarga e o aparelho reenviou)
    const jaTem = await db.errorLog.findFirst({
      where: {
        source: { in: ["client", FONTE_TELA_VERSAO_VELHA] },
        createdAt: { gte: new Date(Date.now() - MS_VALIDADE_DO_RELATO - 86_400_000) },
        detail: { contains: marcaDoRelato },
      },
      select: { id: true },
    });
    if (jaTem) return NextResponse.json({ ok: true });

    const esperado = relatoEsperado(r);
    // a marca diz na lista do painel, sem abrir, qual caso foi
    const marca = esperado
      ? "[tela · versão velha] "
      : r.versaoVelha
        ? "[tela · peça que não carregou] "
        : "[tela] ";

    await logServerError({
      source: esperado ? FONTE_TELA_VERSAO_VELHA : "client",
      alarme: false,
      path: soOCaminho(r.caminho),
      message: `${marca}${r.mensagem}`,
      detail: [
        `loja: ${user.companyId} · pessoa: ${user.id} (${user.role})` +
          (user.impersonatedBy ? " · acesso do Super Admin" : ""),
        marcaDoRelato,
        `quando (relógio do aparelho): ${r.quando}`,
        navegador ? `navegador: ${navegador}` : null,
        r.detalhe,
      ]
        .filter(Boolean)
        .join("\n"),
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    throw e;
  }
}
