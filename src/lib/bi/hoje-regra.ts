/**
 * A PARTE PURA da faixa "Hoje" (RN-088) — o que o NAVEGADOR importa. O motor
 * (`hoje.ts`) fala com o banco e não pode chegar ao navegador (o defeito do
 * deploy de 17/08/2026; o guarda `navegador-sem-servidor.test.ts` derruba).
 */

/** de quanto em quanto tempo a tela pede os números (ms) */
export const INTERVALO_DA_FAIXA_MS = 30_000;

export type NumerosDeHoje = {
  dia: string;
  leads: number;
  pedidosPagos: number;
  vendido: number;
  esperandoAgora: number;
  /** quando foram calculados (ISO) */
  em: string;
};

/** "agora", "há 40 s", "há 2 min" — minutos INTEIROS para baixo (90 s ainda é 1 min) */
export function textoDeAtualizado(segundos: number): string {
  if (segundos < 5) return "agora";
  if (segundos < 60) return `há ${Math.floor(segundos)} s`;
  return `há ${Math.floor(segundos / 60)} min`;
}

/** o que a faixa diz quando o pedido falha — pelo status, não "sem conexão" para tudo (achado da revisão) */
export function avisoDaFalha(status: number | null): string {
  if (status === 401) return "sua sessão venceu — entre de novo em outra aba";
  if (status === 403 || status === 404) return "o BI não está mais disponível para você";
  return "sem conexão — mostrando o último número";
}
