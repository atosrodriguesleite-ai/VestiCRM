"use client";

import { TelaDeErro } from "@/components/tela-de-erro";

/**
 * RN-066 · Quebra ABAIXO do layout raiz que não tem boundary mais perto:
 * o catálogo público, a bio, as páginas públicas — e o próprio esqueleto do
 * app (o layout com o menu), que está DENTRO deste boundary e por isso some
 * junto. Só o layout raiz fica de pé. As telas do app têm boundary próprio
 * (`(app)/error.tsx`), que mantém o menu. Sem este arquivo, o Next mostrava
 * a frase crua em inglês.
 */
export default function Erro({ error }: { error: Error & { digest?: string } }) {
  return <TelaDeErro error={error} />;
}
