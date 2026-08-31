/**
 * O dia do financeiro na tela. Fica num arquivo PURO porque tanto as telas
 * do navegador quanto as do servidor escrevem data — e função exportada de
 * um arquivo `"use client"` não pode ser chamada no servidor (o Next troca a
 * importação por uma referência e a chamada estoura em produção; foi o
 * defeito de 17/08/2026, guardado pelo `navegador-sem-servidor.test.ts`).
 */

/** "2026-09-05" → "05/09/2026" (o dia já vem pronto do servidor, em SP). */
export function formatarDia(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}
