"use client";

import { useEffect } from "react";
import {
  CHAVE_RELATO_PENDENTE,
  EVENTO_RELATO_GUARDADO,
  relatoAindaVale,
} from "@/lib/erro-da-tela";

/**
 * RN-065 · Manda ao painel de Saúde o relato da última tela que quebrou
 * neste aparelho (guardado pela `TelaDeErro`): ao montar — o que ficou de
 * uma quebra anterior, de antes do login ou de antes de uma recarga — e NA
 * HORA em que uma tela do app quebra sem recarregar (o evento), porque o app
 * instalado fica aberto por dias sem carregamento completo.
 *
 * Mora no layout da área logada: quem quebrou com a sessão vencida recarrega,
 * cai no login, entra — e aí o relato sai. É a mesma ideia do pedido do
 * catálogo (RN-010): guardado no aparelho até chegar.
 */
export function EnviarRelatoDeErro() {
  useEffect(() => {
    let enviando = false;
    const mandar = () => {
      if (enviando) return;
      let texto: string | null = null;
      try {
        texto = window.localStorage.getItem(CHAVE_RELATO_PENDENTE);
      } catch {
        return;
      }
      if (!texto) return;
      const enviado = texto;
      let corpo: unknown;
      try {
        corpo = JSON.parse(enviado);
      } catch {
        apagarSeForOMesmo(enviado);
        return;
      }
      // guardado há mais de uma semana (o aparelho ficou sem login esse tempo
      // todo): a pista já esfriou, e o painel mostraria um erro velho como novo
      if (!relatoAindaVale((corpo as { quando?: unknown })?.quando, Date.now())) {
        apagarSeForOMesmo(enviado);
        return;
      }
      enviando = true;
      fetch("/api/erro-da-tela", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(corpo),
        // a página pode estar recarregando neste instante: o envio termina
        // mesmo assim, e se a resposta se perder no caminho o relato é
        // mandado de novo depois — o servidor não grava o mesmo id duas vezes
        keepalive: true,
      })
        .then((res) => {
          // sessão caiu: o relato espera o próximo login
          if (res.status === 401) return;
          // servidor com defeito: tenta no próximo carregamento (o ritmo do
          // servidor responde 429 se isso se repetir, e aí encerra)
          if (res.status >= 500) return;
          // aceito, recusado ou barrado pelo ritmo: encerra — reenviar um
          // relato recusado a cada abertura do app seria spam no painel
          apagarSeForOMesmo(enviado);
        })
        .catch(() => {
          // sem rede: fica para a próxima
        })
        .finally(() => {
          enviando = false;
        });
    };
    mandar();
    window.addEventListener(EVENTO_RELATO_GUARDADO, mandar);
    return () => window.removeEventListener(EVENTO_RELATO_GUARDADO, mandar);
  }, []);
  return null;
}

/**
 * Só apaga se o que está guardado ainda é o que foi mandado: uma quebra
 * NOVA gravada enquanto este envio viajava não pode sumir junto.
 */
function apagarSeForOMesmo(enviado: string) {
  try {
    if (window.localStorage.getItem(CHAVE_RELATO_PENDENTE) === enviado) {
      window.localStorage.removeItem(CHAVE_RELATO_PENDENTE);
    }
  } catch {
    // nada a fazer
  }
}
