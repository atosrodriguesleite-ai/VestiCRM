/**
 * NOME PROVISÓRIO — regra PURA (sem banco, sem Node).
 *
 * Mora sozinha porque telas do navegador precisam dela (o painel de Envio, a
 * página de rastreio). Deixá-la dentro do `intake.ts` arrastava o Prisma para
 * dentro do pacote do navegador — foi assim que o deploy de 17/08/2026 caiu,
 * e as telas da área logada ainda empacotavam o banco à toa (revisão 18/08).
 */
/**
 * O cliente tem nome de VERDADE ou um apelido que o próprio sistema inventou?
 *
 * Quando a mensagem chega antes de a gente saber quem é, o sistema batiza o
 * contato com o telefone: "Contato (77) 8101-4696", "Lead 4696", "Cliente do
 * catálogo (não identificado)". Isso é um crachá provisório — assim que o
 * nome de verdade aparecer (a cliente digita no catálogo, por exemplo), ele
 * TEM que substituir o crachá.
 *
 * O contrário nunca: nome escrito por gente não é sobrescrito por nada.
 */
export function nomeProvisorio(nome: string | null | undefined): boolean {
  const n = (nome ?? "").trim();
  if (!n) return true;
  return (
    /^contato\b/i.test(n) ||
    /^lead\s+\d+$/i.test(n) ||
    /^cliente do cat[áa]logo/i.test(n) ||
    // só dígitos/pontuação de telefone: o número virou "nome"
    /^[\d\s()+.-]+$/.test(n)
  );
}
