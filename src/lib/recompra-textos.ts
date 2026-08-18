/**
 * RECOMPRA — as partes PURAS (rótulos das faixas e as mensagens prontas).
 *
 * Ficam separadas porque a TELA (navegador) precisa delas. Enquanto moravam
 * dentro do motor `recompra.ts`, que fala com o banco, o Prisma inteiro era
 * empacotado e executado no navegador — o mesmo defeito que derrubou o deploy
 * de 17/08/2026, só que ainda sem estourar (revisão 18/08/2026).
 */

export type Faixa = "ATIVA" | "ESFRIANDO" | "RISCO" | "SUMIDA";

export const FAIXAS: { id: Faixa; rotulo: string; cor: string }[] = [
  { id: "ATIVA", rotulo: "Ativa", cor: "#059669" },
  { id: "ESFRIANDO", rotulo: "Esfriando", cor: "#d97706" },
  { id: "RISCO", rotulo: "Em risco", cor: "#ea580c" },
  { id: "SUMIDA", rotulo: "Sumida", cor: "#e11d48" },
];

// ---- Mensagens prontas (a vendedora dispara) -------------------------------

export function mensagemHoraDeRepor(nome: string, ciclo: number | null, link: string): string {
  const primeiro = nome.trim().split(/\s+/)[0];
  return [
    `Oi ${primeiro}! 💛 Já faz um tempinho desde a sua última reposição${
      ciclo ? ` (você costuma renovar a cada ${ciclo} dias)` : ""
    }.`,
    `Chegou muita coisa boa — dá uma olhada no catálogo:\n${link}`,
    "Se quiser, separo as novidades do seu estilo. 😉",
  ].join("\n\n");
}

export function mensagemAniversario(nome: string, link: string): string {
  const primeiro = nome.trim().split(/\s+/)[0];
  return [
    `${primeiro}!! 🎉 Feliz aniversário! Que seu mês seja incrível!`,
    `Passando para te desejar tudo de bom — e se quiser se presentear, o catálogo está cheio de novidade:\n${link}`,
  ].join("\n\n");
}

export function mensagemNovidade(nome: string, categoria: string, link: string): string {
  const primeiro = nome.trim().split(/\s+/)[0];
  return [
    `Oi ${primeiro}! 💛 Lembrei de você: chegaram novidades em ${categoria} — bem a sua praia.`,
    `Olha aqui antes que as grades quebrem:\n${link}`,
  ].join("\n\n");
}

export function mensagemVipLancamento(nome: string, link: string): string {
  const primeiro = nome.trim().split(/\s+/)[0];
  return [
    `${primeiro}, você é uma das nossas clientes mais especiais 💎`,
    `Por isso está vendo o lançamento ANTES de todo mundo — escolhe primeiro, garante as grades cheias:\n${link}`,
  ].join("\n\n");
}
