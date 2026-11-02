/**
 * O PEDIDO DE "REINICIAR CONEXÃO" PELA TELA (RN-105) — um leitor para os dois
 * botões (a tela Comunicação da loja e o cartão da loja no painel de Saúde).
 * Só navegador: sem banco, sem Prisma. A resposta da porta é sempre
 * `{ ok, mensagem }`; o que não vier assim vira frase em português.
 */
import { avisoDaRecusa } from "./sessao";
export type ResultadoNaTela = { ok: boolean; mensagem: string };

export const CONFIRMACAO_DO_REINICIO =
  "A sessão salva é reaproveitada; em geral não pede QR Code. Use quando as mensagens das clientes pararam de entrar.";

export async function pedirReinicio(
  url: string,
  body?: Record<string, unknown>,
): Promise<ResultadoNaTela> {
  try {
    const res = await fetch(url, {
      method: "POST",
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const d = (await res.json().catch(() => null)) as {
      ok?: boolean;
      mensagem?: string;
      error?: string;
      sessao?: string;
    } | null;
    // RN-064 pela régua da casa (`avisoDaRecusa`): o 401 do porteiro (sessão
    // vencida) manda para outra aba; o 401 SEM a marca (usuária desativada,
    // loja suspensa) manda falar com quem administra — outra aba ali é beco
    if (!res.ok || !d)
      return {
        ok: false,
        mensagem: avisoDaRecusa(res.status, d, "Não foi possível reiniciar agora."),
      };
    return { ok: !!d.ok, mensagem: d.mensagem ?? "" };
  } catch {
    return { ok: false, mensagem: "Sem conexão com o sistema. Tente de novo." };
  }
}
