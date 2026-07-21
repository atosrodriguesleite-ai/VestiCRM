"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Renderiza os filhos direto no <body>, fora da árvore da página.
 *
 * Por que existe: as janelas (modais/bottom-sheets) são `position: fixed`,
 * mas quando ficam dentro do conteúdo elas acabam "presas" abaixo da barra
 * de navegação de baixo do celular (o botão do rodapé some atrás dela).
 * Jogando a janela para o <body>, ela passa a ficar acima de tudo — inclusive
 * da barra — como um modal deve se comportar. Só afeta o celular; no desktop
 * (sem barra de baixo) o resultado é idêntico ao de antes.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
