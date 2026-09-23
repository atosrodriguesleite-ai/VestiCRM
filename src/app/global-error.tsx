"use client";

import { TelaDeErro } from "@/components/tela-de-erro";

/**
 * RN-065 · Quebra no ESQUELETO do app (o layout raiz): aqui o Next troca a
 * página inteira, então este arquivo precisa trazer o próprio `<html>`,
 * `<head>` e `<body>`. O `viewport` vai escrito à mão: o do layout raiz
 * pode não valer quando é justamente ele que caiu, e sem ele o iPhone
 * desenha a página com 980px, miúda — a tela de socorro ilegível no
 * aparelho onde ela mais aparece. A `TelaDeErro` não depende do CSS do app.
 */
export default function ErroGlobal({ error }: { error: Error & { digest?: string } }) {
  return (
    <html lang="pt-BR">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>AtacadoPro</title>
      </head>
      <body style={{ margin: 0 }}>
        <TelaDeErro error={error} />
      </body>
    </html>
  );
}
