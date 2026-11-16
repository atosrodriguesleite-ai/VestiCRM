import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";
import { orderScope } from "@/lib/scope";
import { abrirXmlDaConsulta, baixarXmlDaNfe, consultarNfe, limparChaveNfe } from "@/lib/bling";
import { logServerError } from "@/lib/health";
import { lerNotaDoXml, type LeituraDaNota } from "@/lib/nfe/xml-da-nota";
import { gerarDanfeSimplificado, lerFormatoDoDanfe } from "@/lib/nfe/danfe-simplificado";

/**
 * DANFE Simplificado – Etiqueta do pedido, em PDF (RN-111).
 *
 * Mora FORA de `/api` de propósito: é um link que abre numa aba, e o
 * porteiro responde JSON a quem chega em `/api` sem sessão — a aba mostraria
 * `{"error":"Não autenticado"}`. Aqui, sem sessão, a pessoa vai para o login,
 * como em qualquer tela.
 *
 * Pelo mesmo motivo a recusa volta como uma PÁGINA em português (e como JSON
 * só para quem pede JSON — o botão do aplicativo instalado, que mostra a
 * frase na própria ficha).
 *
 * Quem vê o pedido (RN-007) imprime o DANFE dele: é o papel que vai colado na
 * caixa, trabalho de quem despacha.
 */

// duas idas ao Bling em paralelo (e, raramente, o link do XML) + o desenho
export const maxDuration = 60;

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SEM_CACHE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

function recusa(req: NextRequest, status: number, titulo: string, frase: string): Response {
  const aceita = req.headers.get("accept") ?? "";
  if (aceita.includes("application/json") && !aceita.includes("text/html"))
    return Response.json({ error: frase }, { status, headers: SEM_CACHE });
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escapar(titulo)}</title></head><body style="font-family:system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#1e293b;line-height:1.5"><h1 style="font-size:1.25rem">${escapar(titulo)}</h1><p>${escapar(frase)}</p><p style="color:#64748b;font-size:.9rem">Pode fechar esta aba e voltar ao pedido.</p></body></html>`;
  return new Response(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8", ...SEM_CACHE },
  });
}

/**
 * Recusas que são RESPOSTA DECIDIDA (a nota é que é assim) não vão ao painel
 * de Saúde como erro — só as que podem ser defeito nosso ou do formato que o
 * Bling devolve (a lição da RN-010: contar resposta decidida enterra os erros
 * de verdade).
 */
const MOTIVOS_PARA_A_SAUDE = new Set(["nao-e-nfe", "outra-nota", "sem-protocolo", "incompleta"]);

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireUser();
  } catch (e) {
    if (e instanceof AuthError)
      return recusa(
        req,
        401,
        "Sua sessão venceu",
        "Entre de novo no sistema e abra o DANFE outra vez."
      );
    throw e;
  }
  const { id } = await params;
  const order = await db.order.findFirst({
    where: { id, ...orderScope(user) },
    select: { id: true, nfeStatus: true, nfeKey: true, nfeBlingId: true, nfeNumber: true },
  });
  if (!order)
    return recusa(req, 404, "Pedido não encontrado", "Este pedido não existe ou não é seu.");
  const chave = limparChaveNfe(order.nfeKey);
  // só nota AUTORIZADA tem DANFE — a régua da etiqueta com NF-e (RN-016)
  if (order.nfeStatus !== "AUTORIZADA" || !chave || !order.nfeBlingId)
    return recusa(
      req,
      409,
      "Este pedido não tem nota autorizada",
      "O DANFE simplificado só existe depois que a nota fiscal é autorizada. Emita a nota no pedido (ou atualize a situação dela) e tente de novo."
    );

  // o botão ao lado da ETIQUETA manda a chave com que ela foi comprada: se a
  // nota do pedido hoje é outra (cancelada e reemitida), os dois papéis da
  // mesma caixa apontariam notas diferentes
  const daEtiqueta = req.nextUrl.searchParams.get("chave");
  if (daEtiqueta && limparChaveNfe(daEtiqueta) !== chave)
    return recusa(
      req,
      409,
      "A etiqueta foi comprada com outra nota",
      "A etiqueta deste envio saiu com uma nota fiscal diferente da nota atual do pedido (a nota foi emitida de novo depois da compra). Confira qual nota vale antes de despachar — o DANFE da nota atual está no painel da nota fiscal do pedido."
    );

  // A SITUAÇÃO DE AGORA, conferida no Bling (a régua da compra da etiqueta,
  // RN-016): o pedido aqui só muda quando alguém clica em "atualizar", e o
  // XML arquivado de uma nota CANCELADA ainda traz o protocolo de autorização
  // — sem conferir, a caixa viajaria com o papel de uma nota cancelada.
  const [situacao, pelaChave] = await Promise.all([
    consultarNfe(user.companyId, order.nfeBlingId).catch(() => ({
      ok: false as const,
      situacao: "EMITINDO",
      chave: undefined,
      xml: undefined,
    })),
    baixarXmlDaNfe(user.companyId, chave),
  ]);
  if (!situacao.ok)
    return recusa(
      req,
      502,
      "Não consegui confirmar a nota no Bling",
      "O Bling não respondeu agora, e sem confirmar que a nota continua autorizada o DANFE simplificado não sai. Tente de novo em instantes — o DANFE completo continua no botão “ver DANFE” do pedido."
    );
  if (situacao.situacao !== "AUTORIZADA") {
    // só nota comprovadamente MORTA mexe no pedido (a régua da etiqueta)
    if (situacao.situacao === "CANCELADA" || situacao.situacao === "REJEITADA")
      await db.order.updateMany({
        where: { id: order.id, nfeBlingId: order.nfeBlingId },
        data: { nfeStatus: situacao.situacao, nfeKey: null },
      });
    return recusa(
      req,
      409,
      "A nota não está mais autorizada",
      `A nota fiscal deste pedido não está mais autorizada no Bling (situação: ${situacao.situacao}). Confira a nota no pedido antes de despachar.`
    );
  }
  if (situacao.chave && situacao.chave !== chave)
    return recusa(
      req,
      409,
      "A nota do pedido mudou",
      "A chave de acesso da nota no Bling não é mais a que está gravada no pedido. Clique em “atualizar” na nota do pedido e abra o DANFE de novo."
    );

  let leitura: LeituraDaNota | null = pelaChave.ok ? lerNotaDoXml(pelaChave.xml, chave) : null;
  // a rota por chave falhou, ou o XML dela veio sem o protocolo: tenta o XML
  // que a consulta da nota aponta (a mesma consulta, sem ida extra à API)
  if ((!leitura || (!leitura.ok && leitura.motivo === "sem-protocolo")) && situacao.xml) {
    const outro = await abrirXmlDaConsulta(situacao.xml);
    if (outro) {
      const segunda = lerNotaDoXml(outro, chave);
      if (segunda.ok || !leitura) leitura = segunda;
    }
  }

  if (!leitura) {
    const erro = pelaChave.ok ? "" : pelaChave.error;
    await logServerError({
      source: "server",
      path: "danfe-simplificado (bling /nfe/documento)",
      message: "Não consegui buscar o XML da NF-e no Bling para o DANFE simplificado",
      detail: `companyId=${user.companyId} status=${pelaChave.ok ? 200 : pelaChave.status} ${erro}`,
      alarme: false,
    });
    return recusa(
      req,
      502,
      "Não consegui buscar a nota no Bling",
      `${erro || "O Bling não devolveu o XML desta nota."} Enquanto isso, o DANFE completo continua no botão “ver DANFE” do pedido.`
    );
  }
  if (!leitura.ok) {
    // só o MOTIVO e os nomes dos campos: nenhum dado da nota vai para o painel
    if (MOTIVOS_PARA_A_SAUDE.has(leitura.motivo))
      await logServerError({
        source: "server",
        path: "danfe-simplificado (leitura do XML)",
        message: `DANFE simplificado recusado: ${leitura.motivo}`,
        detail: `companyId=${user.companyId} faltam=${(leitura.faltam ?? []).join("; ")}`,
        alarme: false,
      });
    return recusa(req, 422, "Não deu para montar o DANFE simplificado", leitura.frase);
  }

  const formato = lerFormatoDoDanfe(req.nextUrl.searchParams.get("formato"));
  const pdf = await gerarDanfeSimplificado(leitura.nota, formato);
  const numero = (order.nfeNumber ?? leitura.nota.numero).replace(/\D/g, "") || "nota";
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="danfe-simplificado-nf-${numero}.pdf"`,
      // é documento com CPF/CNPJ: não fica em cache de ninguém
      ...SEM_CACHE,
    },
  });
}
