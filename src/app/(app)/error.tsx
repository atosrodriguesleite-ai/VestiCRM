"use client";

import { TelaDeErro } from "@/components/tela-de-erro";

/**
 * RN-066 · Quebra numa TELA do app (pedidos, chat, produtos…): este
 * boundary fica DENTRO do layout do app, então o menu continua de pé — é
 * ele a saída quando a quebra se repete a cada recarga (achado da revisão:
 * com o boundary só na raiz, o menu sumia e o único botão levava de volta à
 * mesma tela quebrada). E quem manda o relato ao painel de Saúde continua
 * montado, então ele sai NA HORA, sem esperar o próximo carregamento.
 */
export default function ErroNoApp({ error }: { error: Error & { digest?: string } }) {
  return <TelaDeErro error={error} inteira={false} />;
}
