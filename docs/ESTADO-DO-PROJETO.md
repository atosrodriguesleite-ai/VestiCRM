# Estado do projeto — AtacadoPro

> **Atualizado em 14/08/2026.** Este arquivo responde três perguntas: o que está
> no ar, o que está pronto mas esperando configuração, e o que está torto.
> Quando mudar alguma dessas coisas, **atualize aqui** — documento desatualizado
> é pior que documento nenhum (a versão anterior deste arquivo dizia que o
> WhatsApp era simulado e que o banco tinha 27 modelos; eram 89).

Para entender o produto e o código, comece por [`../README.md`](../README.md) e
[`PRIMEIRO-DIA.md`](PRIMEIRO-DIA.md).

---

## Onde as coisas rodam

| | |
| --- | --- |
| **App e site** | https://www.atacadopro.com (Vercel, plano Hobby) |
| **Catálogos** | `catalago.net/{loja}` — link curto por loja |
| **Bio pública** | `www.atacadopro.com/bio/{slug}` |
| **Banco** | Neon (PostgreSQL, região São Paulo) |
| **WhatsApp** | Evolution API self-hosted — VPS Hostinger `srv1853369.hstgr.cloud`, projeto Docker `evolução-api-2zk0` |
| **DNS** | HostGator (A `@` → 216.198.79.1, CNAME `www` → cname.vercel-dns.com) |
| **Branch de deploy** | `claude/modacrm-clothing-crm-cxa9gf` — **push nela = produção em ~3 min** |

O `vercel-build` roda, nesta ordem: guard de crons → `migrate-deploy.mjs`
(aplica migrações, com destravador de P3009) → `prisma/bootstrap.ts` (cria a
empresa-plataforma e o Super Admin) → `next build`.

---

## ✅ No ar e funcionando

**Lojas reais pagantes** usando o sistema no dia a dia (Toque Leve, Entre
Linhas, entre outras). A própria empresa-plataforma usa o AtacadoPro para gerir
os leads do AtacadoPro.

- **CRM completo** — carteira, funil kanban, tarefas/agenda, automações,
  campanhas, recompra, recuperação de carrinho.
- **Central de Atendimento WhatsApp** — conexão por QR Code, tempo real, mídia,
  áudio, pedido dentro do chat, transferência, setores. Provado com 2.007
  conversas / 120 mil mensagens.
- **Catálogo público** com link rastreado por vendedora e por cliente,
  atribuição de comissão e recuperação de pedido perdido.
- **Pedidos e estoque** — reserva sem prazo, livro de movimentos auditável,
  romaneio, PDF de orçamento, "Colar pedido do WhatsApp".
- **Pagamento por InfinitePay** — checkout por link (Pix e cartão) com
  confirmação automática. **Não depende de configuração da plataforma**: cada
  loja liga a própria InfiniteTag em Configurações.
- **Integração Nuvemshop** — OAuth, webhooks HMAC, a Nuvemshop é a dona do
  estoque, venda paga vira pedido PAGO direto.
- **Integração Jueri** — sync 2x/dia pelos dois slots de cron.
- **Produção** (módulo gated) — tecidos, rolos, cortes, costura, facções,
  defeitos, plano de corte lendo Audaces/DXF.
- **Marketing** — gestor de bio, campanhas, tracking do catálogo, tela
  Inteligência, vínculo anúncio → campanha direto do chat.
- **Monitoramento** — `src/lib/health.ts` roda **de carona no tráfego, sem cron
  novo**: checa o servidor Evolution e a conexão de cada loja, alerta por sino e
  push com anti-spam. Erros de produção são capturados por
  `src/instrumentation.ts` (`onRequestError`) e caem no painel `/saude`
  (Super Admin).
- **Super Admin** — provisionar loja, cobrança, uso, suspender, impersonar,
  diagnóstico de fotos. Loja demo "Bella Moda".

---

## ⏳ Pronto no código, esperando configuração externa

Estes módulos estão **completos e testados**, mas não funcionam em produção
enquanto alguém não criar o app no fornecedor e colar as chaves na Vercel.
Nenhum deles exige mudança de código.

| Módulo | O que falta | Onde criar |
| --- | --- | --- |
| **Mercado Pago** (Pix marketplace, taxa 0,5%) | envs `MP_CLIENT_ID` e `MP_CLIENT_SECRET` | mercadopago.com.br/developers/panel — callback `https://www.atacadopro.com/api/mercadopago/callback` |
| **NF-e via Bling** | envs `BLING_CLIENT_ID` e `BLING_CLIENT_SECRET` | developer.bling.com.br — callback `.../api/bling/callback` |
| **Melhor Envio** (frete, etiqueta, rastreio) | envs `MELHOR_ENVIO_CLIENT_ID` e `MELHOR_ENVIO_CLIENT_SECRET` + ligar a chave por loja no painel Lojas | melhorenvio.com.br, área do desenvolvedor — callback `.../api/melhorenvio/callback` |
| **Importação de histórico do WhatsApp** | ligar `DATABASE_SAVE_DATA_HISTORIC`, `..._NEW_MESSAGE`, `..._CHATS`, `..._CONTACTS` = `true` no compose do servidor Evolution (Hostinger, Editor .yaml) e **reconectar as lojas** | VPS Hostinger |
| **`INTAKE_SECRET`** | conferir se está definida na Vercel | ⚠️ sem ela, `/api/intake/*` responde **503** (fail-closed, por desenho — ver [`INCIDENTES.md`](INCIDENTES.md) #10) |

> Parceria/comissão com o Melhor Envio está em negociação à parte — o módulo é
> pago separadamente pelas lojas (`shippingEnabled`).

---

## ⚠️ Dívidas técnicas conhecidas

Em ordem de risco:

**1. Fotos e mídias são data-URL no banco.** Servidas por `/api/img/[id]` com
cache. Funciona, mas incha o Postgres, encarece o Neon e limita o tamanho do
upload. **Migração para blob storage está planejada** — é a dívida nº 1.

**2. Telas gigantes.** 21 arquivos passam de 800 linhas. Os piores:

| Arquivo | Linhas |
| --- | --- |
| `src/app/(app)/whatsapp/inbox.tsx` | 3.422 |
| `src/app/(app)/produtos/products-view.tsx` | 2.082 |
| `src/app/catalogo/[slug]/public-catalog.tsx` | 2.007 |
| `src/lib/nuvemshop.ts` | 1.281 |

Arquivo desse tamanho é onde bug se esconde e onde quem chegou agora trava.

**3. Sem rate-limit no login.** `/api/auth/login` aceita tentativas infinitas.

**4. Um único autor no histórico.** 115 commits, todos da mesma fonte. Nenhum
outro desenvolvedor humano leu este código com olhos de manutenção — não existe
hoje uma "segunda pessoa" que já o entenda. Estes documentos (`PRIMEIRO-DIA`,
`INCIDENTES`) são a primeira tentativa de reduzir esse risco.

**5. Node sem versão declarada.** O `package.json` não tem `engines`. Use 20 ou 22.

---

## 🗓️ O que aconteceu recentemente

Resumo das últimas semanas, para quem precisa de contexto rápido (o `git log`
tem a história completa, com o efeito de cada mudança descrito em linguagem de
negócio):

- **12/08** — Integração **InfinitePay** completa: checkout por link, Pix e
  cartão, confirmação automática, tela do pedido virando "Pago" sozinha.
  Romaneio na ordem de separação (categoria → produto → cor → tamanho).
- **10/08** — Deploy destravado (migração falhada não prende mais o site).
  Cancelamento com escolha de devolver ou dar baixa definitiva no estoque.
- **09/08** — **Regra permanente: revisão especialista antes de todo push.**
  17 correções de auditoria em NF-e e Mercado Pago. Cinco lotes de correção
  (segurança de escopo, estoque/integrações, números que não batiam, plataforma).
- **07–08/08** — Hotfix de segurança (XSS na bio, rotas de intake fail-open).
  Conferidor de catálogo: o sistema passa a dizer **por que** uma peça não
  aparece.
- **05–06/08** — Catálogo para lojas sem cor (semijoias), organizador de
  catálogo, pedidos blindados (duas auditorias).
- **01–03/08** — Módulo **IA de Vendas** (entrega 1), painel de Recompra, linha
  do tempo comercial na ficha do cliente.
- **27/07–31/07** — Faturamento passa a contar pela data do **pagamento**;
  métricas conferidas de ponta a ponta; WhatsApp preparado para milhares de
  conversas; auditoria completa de segurança e métricas.

---

## 🧭 Próximos passos sugeridos

Não há um roadmap fechado. As frentes abertas, em ordem de valor:

1. **Destravar os três módulos que só esperam chave** (Mercado Pago, Bling,
   Melhor Envio) — é o maior ganho por menor esforço: código pronto, parado.
2. **Ligar o histórico no servidor Evolution** — sem isso a importação de 30
   dias devolve ~0 mensagens e a loja nova entra sem contexto.
3. **Blob storage para as fotos** — resolve custo, performance e o teto de
   upload de uma vez.
4. **Quebrar o `inbox.tsx`** em componentes — é a maior barreira para alguém
   novo conseguir mexer no WhatsApp com segurança.
5. **Rate-limit no login.**
