import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
