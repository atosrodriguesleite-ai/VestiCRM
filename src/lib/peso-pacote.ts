/**
 * Peso suspeito no envio — regra pura, sem servidor: a tela do pedido (que
 * roda no navegador) usa junto com o motor do Melhor Envio, e módulo de
 * navegador não pode importar `lib/melhorenvio.ts` (ele fala com o banco).
 */

/**
 * O peso digitado destoa do calculado pelas peças? (o dobro, ou metade)
 * Pega tanto dedo escorregado na balança quanto peso errado no cadastro do
 * produto — aviso amarelo na tela, nunca trava (a balança pode estar certa).
 */
export function pesoDivergente(manualKg: number, automaticoKg: number): boolean {
  if (!(manualKg > 0) || !(automaticoKg > 0)) return false;
  const razao = manualKg / automaticoKg;
  return razao >= 2 || razao <= 0.5;
}
