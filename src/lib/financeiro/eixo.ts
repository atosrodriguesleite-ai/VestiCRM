/**
 * O EIXO dos gráficos do painel — regra pura, sem React: as marcas "redondas"
 * e o valor curto ("R$ 12 mil"). Mora fora do `.tsx` para o teste poder
 * exercitar sem montar componente.
 */

/** Marcas "redondas" para o eixo: 4 passos entre o menor e o maior valor. */
export function marcasDoEixo(min: number, max: number): number[] {
  const baixo = Math.min(0, min);
  // curva chapada (loja sem conta, tudo zero) ganha uma faixa mínima de R$ 100
  // para o eixo não virar uma marca só
  const alto = Math.max(0, max, baixo + 100);
  const faixa = alto - baixo;
  const bruto = faixa / 4;
  const potencia = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * potencia).find((p) => p >= bruto) ?? potencia * 10;
  const marcas: number[] = [];
  for (let v = Math.floor(baixo / passo) * passo; v <= Math.ceil(alto / passo) * passo + 1e-9; v += passo) {
    marcas.push(Math.round(v * 100) / 100);
  }
  return marcas;
}

/** "R$ 12,3 mil" — o eixo não tem espaço para centavos. */
export function valorCurto(v: number): string {
  const abs = Math.abs(v);
  const sinal = v < 0 ? "−" : "";
  if (abs >= 1_000_000)
    return `${sinal}R$ ${(abs / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (abs >= 1_000)
    return `${sinal}R$ ${(abs / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: abs < 10_000 ? 1 : 0 })} mil`;
  return `${sinal}R$ ${abs.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}`;
}
