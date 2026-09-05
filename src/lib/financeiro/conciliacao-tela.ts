/**
 * A CONFERÊNCIA VISTA DA TELA (RN-037) — parte pura.
 *
 * Mora fora do motor porque o NAVEGADOR precisa dela: `conciliacao.ts` fala
 * com o banco, e função exportada de arquivo de servidor não pode ser
 * importada por componente `"use client"` (guarda
 * `navegador-sem-servidor.test.ts`). Aqui só entram regras que se decidem
 * com os números na mão.
 */

/** Folga em dias entre a data da baixa e a do banco no casamento (RN-037). */
export const JANELA_DIAS = 3;

/** Um movimento com dia ("2026-09-05") e valor com sinal. */
export type Movimento = { dia: string; valor: number };

/** Distância em dias entre dois dias do calendário. */
export function diasEntre(a: string, b: string): number {
  const t = (d: string) => new Date(`${d}T12:00:00.000Z`).getTime();
  return Math.abs((t(a) - t(b)) / 86_400_000);
}

/**
 * A baixa COMBINA com a linha do banco? Mesma régua do casamento automático:
 * mesmo valor com o mesmo sinal e data dentro da janela. Serve para subir as
 * candidatas prováveis para o topo — a lojista continua decidendo, porque
 * duas baixas de R$ 300 no mesmo dia são exatamente onde o palpite erra.
 */
export function combinaComALinha(
  baixa: Movimento,
  linha: Movimento,
  janelaDias = JANELA_DIAS
): boolean {
  return (
    Math.abs(baixa.valor - linha.valor) < 0.005 &&
    diasEntre(baixa.dia, linha.dia) <= janelaDias
  );
}

/** Texto sem acento e em minúsculas, para a busca achar "Adriana" em "ADRIANA". */
export function semAcento(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * A lista da direita: filtra pela busca e sobe as que combinam com a linha
 * escolhida. A MARCADA nunca some — a busca que esconde item marcado
 * "desmarcaria" a conferência sem a lojista perceber, e ela conferiria a
 * linha com menos dinheiro do que escolheu.
 */
export function ordenarCandidatas<T extends Movimento & { id: string; descricao: string; pessoa?: string | null }>(
  candidatas: T[],
  linha: Movimento | null,
  busca: string,
  marcadas: string[]
): T[] {
  const termo = semAcento(busca.trim());
  const combina = (c: T) => (linha ? combinaComALinha(c, linha) : false);
  return candidatas
    .filter(
      (c) =>
        !termo ||
        marcadas.includes(c.id) ||
        semAcento(`${c.descricao} ${c.pessoa ?? ""}`).includes(termo)
    )
    .sort((a, b) => {
      const pa = combina(a) ? 0 : 1;
      const pb = combina(b) ? 0 : 1;
      return pa !== pb ? pa - pb : a.dia.localeCompare(b.dia);
    });
}

/**
 * COMO O DINHEIRO DO BANCO BAIXA AS PARCELAS (RN-037/RN-030): em ordem, cada
 * uma até o SEU valor. Um Pix de R$ 100 num lançamento de 3× quita a primeira
 * e para — parcela nunca recebe mais do que vale, senão o saldo do lançamento
 * ficaria negativo e o extrato divergiria do banco.
 */
export function dividirBaixaNasParcelas(
  alvo: number,
  parcelas: { id: string; valor: number }[]
): { parcelaId: string; valor: number }[] {
  const cent = (n: number) => Math.round(n * 100);
  let restante = cent(alvo);
  const saida: { parcelaId: string; valor: number }[] = [];
  for (const p of parcelas) {
    if (restante <= 0) break;
    const valor = Math.min(cent(p.valor), restante);
    if (valor <= 0) continue;
    saida.push({ parcelaId: p.id, valor: valor / 100 });
    restante -= valor;
  }
  return saida;
}

/**
 * A JANELA que a tela de conferir com o banco abre por padrão: do 1º dia de
 * três meses atrás até hoje. Mora aqui (puro) porque o painel do Financeiro
 * conta as pendências pela MESMA janela — número diferente do da tela de
 * destino faz a lojista concluir que um dos dois está errado.
 */
export function janelaPadraoDaConciliacao(hojeDia: string): { de: string; ate: string } {
  const [ano, mes] = hojeDia.split("-").map(Number);
  return { de: new Date(Date.UTC(ano, mes - 3, 1)).toISOString().slice(0, 10), ate: hojeDia };
}
