import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // RN-113 · A VERSÃO DESTE BUILD, escrita no código do navegador e do
  // servidor: é o commit de onde ele saiu (a Vercel informa no build). A tela
  // aberta compara a dela com a de `/api/versao` e avisa quando saiu versão
  // nova. Vazia fora da Vercel — aí o aviso não existe. NUNCA um relógio ou
  // um sorteio aqui: este arquivo é lido mais de uma vez no mesmo build, e
  // navegador e servidor sairiam com versões diferentes (aviso eterno).
  env: {
    NEXT_PUBLIC_VERSAO_DO_APP: process.env.VERCEL_GIT_COMMIT_SHA ?? "",
  },
  experimental: {
    // Fluidez de navegação: uma aba visitada há pouco reabre NA HORA,
    // direto do cache do navegador, em vez de esperar o servidor.
    // 120s cobre o vai-e-volta natural entre abas durante o trabalho
    // (antes eram 30s — bastava demorar um pouco numa tela para a volta
    // ficar lenta de novo). Toda ação de escrita chama router.refresh(),
    // que invalida esse cache — os dados continuam corretos após qualquer
    // mudança; e a inbox tem sync próprio a cada 3s, indiferente a isso.
    //
    // `static` TEM que acompanhar o `dynamic` (15/11/2026): o menu passou a
    // pedir a tela INTEIRA quando o dedo encosta (`adiantar`, no app-shell),
    // e tela pedida assim o Next guarda pelo prazo `static` — 5 minutos por
    // padrão. Medido no navegador: voltar para Pedidos depois de 200s
    // mostrava a lista GUARDADA, sem o pedido que entrou no meio. Com os
    // dois iguais, vale a régua de sempre: 2 minutos.
    staleTimes: {
      dynamic: 120,
      static: 120,
    },
  },
};

export default nextConfig;
