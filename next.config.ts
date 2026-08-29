import type { NextConfig } from "next";

/**
 * DEFESAS QUE O SERVIDOR ENSINA AO NAVEGADOR (auditoria 29/08/2026).
 *
 * Até aqui o app não mandava nenhuma: cada aba abria sem instrução nenhuma
 * de segurança. São quatro linhas que fecham quatro portas diferentes.
 *
 * `frame-ancestors 'none'` (+ o X-Frame-Options antigo, para navegador
 * velho) é a mais importante do dia a dia: sem ela, um site falso põe o
 * AtacadoPro DENTRO dele, invisível, e a lojista clica achando que está
 * clicando noutra coisa — dá para fazê-la aprovar o que o golpista quiser.
 *
 * `Strict-Transport-Security` é o aviso permanente: "deste domínio, NUNCA
 * aceite conexão sem criptografia". A Vercel já redireciona, mas o redirect
 * só age DEPOIS do primeiro pedido — que é exatamente o que se intercepta
 * num Wi-Fi de shopping. `preload` fecha até a primeira visita.
 *
 * `nosniff` impede o navegador de adivinhar o tipo do arquivo pelo conteúdo
 * (a outra metade da trava de foto da RN-026).
 *
 * Referrer-Policy: sem ela, o endereço da tela em que a lojista estava —
 * com id de pedido e de cliente dentro — vai junto em toda saída para fora.
 *
 * CSP completo (a lista de onde a página pode carregar script) NÃO entra
 * aqui: em app grande ele quebra tela em produção se for escrito no chute.
 * Vira entrega própria, medida com o modo "só relatar" antes de valer.
 */
const SEGURANCA = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    // 1 ano, SEM `preload`: `preload` afirma uma inscrição na lista dos
    // navegadores que não foi feita — e, uma vez aceita, ela não se desfaz
    // pelo servidor. Quando quisermos de verdade, é decisão à parte.
    key: "Strict-Transport-Security",
    value: "max-age=31536000; includeSubDomains",
  },
];

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
  async headers() {
    // ORDEM IMPORTA, e ao contrário do que parece: quando duas entradas
    // casam com o mesmo endereço, a ÚLTIMA vence. Medido no servidor de
    // verdade (29/08/2026) — com a regra específica em cima, ela era
    // apagada pela geral e o `sandbox` sumia sem ninguém notar.
    return [
      {
        // Todas as telas e rotas.
        source: "/:path*",
        headers: SEGURANCA,
      },
      {
        // AS PORTAS QUE SERVEM ARQUIVO, com CSP mais apertado por cima.
        //
        // O cabeçalho definido AQUI vence o que a própria rota põe na
        // resposta: a rota de foto mandava `sandbox` e chegava ao navegador
        // só o `frame-ancestors`. Então o CSP dessas portas mora aqui, que é
        // onde ele de fato acontece.
        //
        // `sandbox` deixa o arquivo inerte se alguém abrir o endereço
        // direto — a rede de segurança da RN-026, atrás da lista de tipos.
        source: "/api/:porta(img|media|messages|funcionarios)/:resto*",
        headers: [
          ...SEGURANCA.filter((h) => h.key !== "Content-Security-Policy"),
          {
            key: "Content-Security-Policy",
            value: "sandbox; default-src 'none'; frame-ancestors 'none'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
