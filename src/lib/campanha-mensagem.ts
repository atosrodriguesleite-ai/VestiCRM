import { primeiroNome } from "./comm/autoria";
import { nomeProvisorio } from "./nome-provisorio";

/**
 * O `{{nome}}` da mensagem de campanha virando o primeiro nome da cliente —
 * e sumindo, junto com o espaço da frente, quando o nome é o crachá
 * provisório do sistema ou está em branco ("Oi {{nome}}!" vira "Oi!", nunca
 * "Oi Contato!" — a régua da saudação do RFM, RN-093/RN-098), sem deixar
 * vírgula órfã ("Olá, {{nome}}!" vira "Olá!"). Pura: o disparo roda no
 * navegador.
 */
export function personalizarCampanha(mensagem: string, nome: string | null | undefined): string {
  const n = (nome ?? "").trim();
  if (!n || nomeProvisorio(n)) {
    return (
      mensagem
        // no começo da linha leva a vírgula de DEPOIS ("{{nome}}, tudo bem?")
        .replace(/(^|\n)[ \t]*\{\{\s*nome\s*\}\}[ \t]*,?[ \t]*/gi, "$1")
        // no meio leva a vírgula e o espaço de ANTES ("Olá, {{nome}}!" vira "Olá!")
        .replace(/[ \t]*,?[ \t]*\{\{\s*nome\s*\}\}/gi, "")
    );
  }
  return mensagem.replace(/\{\{\s*nome\s*\}\}/gi, primeiroNome(n));
}
