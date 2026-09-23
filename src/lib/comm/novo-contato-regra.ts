/**
 * Régua PURA da janela "Novo contato" da Central (23/09/2026): o que o
 * navegador decide antes de chamar as portas de sempre (cadastro manual +
 * abrir conversa). Separada do componente para ter teste — a comparação de
 * nome e o recorte de telefone quebravam em silêncio dentro do JSX.
 */

/** Só os dígitos do que foi digitado no campo de telefone. */
export function digitosDoTelefone(texto: string): string {
  return texto.replace(/\D/g, "");
}

/**
 * Telefone completo o bastante para ir ao servidor: DDD + número (10/11
 * dígitos) ou com o DDI 55 na frente (12/13). Doze dígitos que NÃO começam
 * com 55 são dedo errado, não um país novo — o servidor normaliza BR
 * (`normalizePhone`) e um número torto viraria ficha inalcançável.
 */
export function telefoneCompleto(digitos: string): boolean {
  if (digitos.length === 10 || digitos.length === 11) return true;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return true;
  return false;
}

/**
 * O número já estava no cadastro (dedup da RN-008) — precisa CONFIRMAR antes
 * de abrir? Só quando a ficha tem OUTRO nome: a vendedora digitou "Ana" e a
 * ficha é da "Maria" — abrir calado a conversa de outra pessoa parece
 * defeito. Nome igual (a ficha é dela mesma, ou o crachá provisório acabou
 * de ganhar este nome pelo intake) abre direto.
 */
export function precisaConfirmarFicha(
  jaExistia: boolean,
  nomeDaFicha: string | null | undefined,
  nomeDigitado: string
): boolean {
  if (!jaExistia) return false;
  const daFicha = (nomeDaFicha ?? "").trim().toLowerCase();
  const digitado = nomeDigitado.trim().toLowerCase();
  return daFicha !== "" && daFicha !== digitado;
}
