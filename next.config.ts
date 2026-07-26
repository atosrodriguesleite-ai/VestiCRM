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
    staleTimes: {
      dynamic: 120,
    },
  },
};

export default nextConfig;
