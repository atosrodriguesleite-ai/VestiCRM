import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Fluidez de navegação: uma aba visitada há pouco reabre na hora,
    // direto do cache do navegador (até 30s), em vez de esperar o servidor.
    // Toda ação de escrita chama router.refresh(), que invalida esse cache —
    // então os dados continuam corretos após qualquer mudança.
    staleTimes: {
      dynamic: 30,
    },
  },
};

export default nextConfig;
