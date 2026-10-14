import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { porteiraBi } from "@/lib/bi/gate";
import { dataDoDia, diaSP } from "@/lib/dia";
import { atualizarFatosDoBiSeDevido, ultimosDias } from "@/lib/bi/fatos";
import { montarPainel, montarVendedoras } from "@/lib/bi/painel";
import { montarTendencia } from "@/lib/bi/tendencia";
import { gerarPdfDoRelatorio, nomeDoArquivo } from "@/lib/bi/relatorio";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * O RELATÓRIO DO PERÍODO EM PDF (RN-090): o mesmo recorte da tela (`de`/`ate`,
 * com o padrão de 30 dias e a régua de dia de `lib/dia`), os mesmos motores
 * (`montarPainel`, `montarVendedoras`, `montarTendencia`) — o papel nunca
 * diz um número diferente da tela. Gerência, com a chave do módulo.
 */
export async function GET(req: NextRequest) {
  const porta = await porteiraBi();
  if (!porta.ok) return porta.resposta;
  const { user } = porta;
  const q = req.nextUrl.searchParams;
  const agora = new Date();
  const hoje = diaSP(agora);
  const ehDia = (d: string | null): d is string => !!d && dataDoDia(d) !== null;
  const de = q.get("de");
  const ate = q.get("ate");
  const periodo = { de: ehDia(de) ? de : ultimosDias(hoje, 30)[0], ate: ehDia(ate) ? ate : hoje };
  if (periodo.de > periodo.ate) periodo.de = periodo.ate;

  await atualizarFatosDoBiSeDevido(user.companyId, { soVivos: true });
  const [company, painel, vendedoras, tendencia] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: user.companyId }, select: { name: true, intakeSlaMinutes: true, horarioComercial: true } }),
    montarPainel(user.companyId, periodo, agora),
    montarVendedoras(user.companyId, periodo),
    montarTendencia(user.companyId, agora),
  ]);
  const bytes = await gerarPdfDoRelatorio({
    loja: company.name,
    geradoPor: user.name,
    geradoEm: agora,
    prazoMin: company.intakeSlaMinutes ?? 60,
    semHorario: !company.horarioComercial,
    painel,
    vendedoras,
    tendencia,
  });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nomeDoArquivo(company.name, painel.periodo)}"`,
      "Cache-Control": "no-store",
    },
  });
}
