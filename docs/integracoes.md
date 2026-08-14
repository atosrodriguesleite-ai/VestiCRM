# Integrações externas — contas, chaves e situação

O que o código **não** consegue dizer: quais contas existem lá fora, em nome de
quem, e o que ainda falta ligar. Uma variável de ambiente sumida vira "não
funciona" sem pista nenhuma; esta é a lista de conferência.

> **Nenhum valor de chave entra neste arquivo.** Segredo vive na Vercel
> (variável de ambiente) ou criptografado no banco (AES-256-GCM,
> `lib/crypto.ts`). Aqui só existe o **nome** da variável.

## Situação de cada integração

| Integração | Para que serve | Situação |
|---|---|---|
| **Evolution API** (WhatsApp) | Central de Atendimento | 🟢 em produção |
| **Nuvemshop** | produtos e estoque (ela é a dona) | 🟢 em produção |
| **Jueri** | catálogo de fornecedor (sync 2×/dia) | 🟢 em produção |
| **Melhor Envio** | cotação e etiqueta de frete | 🟢 em produção (desde 13/08/2026) |
| **Mercado Pago** | Pix com baixa automática | 🔴 falta criar o app |
| **Bling** | NF-e (e a chave da etiqueta com nota) | 🔴 falta criar o app |
| **InfinitePay** | cobrança por link | 🟡 código pronto, ligar por loja |

## Chaves da plataforma (Vercel → Environment Variables)

Valem para o sistema inteiro. Sem elas o módulo não liga para loja nenhuma.

| Variável | Integração | Situação |
|---|---|---|
| `EVOLUTION_URL`, `EVOLUTION_KEY` | Evolution | ✅ configuradas |
| `MELHOR_ENVIO_CLIENT_ID`, `MELHOR_ENVIO_CLIENT_SECRET` | Melhor Envio | ✅ configuradas |
| `MP_CLIENT_ID`, `MP_CLIENT_SECRET` | Mercado Pago | ❌ pendente |
| `BLING_CLIENT_ID`, `BLING_CLIENT_SECRET` | Bling | ❌ pendente |
| `INTAKE_SECRET` | entrada de leads | ⚠️ conferir se está na Vercel |
| `NUVEMSHOP_CLIENT_ID`, `NUVEMSHOP_CLIENT_SECRET` | Nuvemshop | ✅ configuradas |
| `AUTH_SECRET`, `DATABASE_URL` | plataforma | ✅ configuradas |
| `SUPERADMIN_EMAIL`, `SUPERADMIN_PASSWORD` | cria o Super Admin no `bootstrap.ts` | ✅ configuradas |
| `CATALOG_DOMAIN` (= `catalago.net`), `MAIN_SITE_URL` | domínio do catálogo público | ✅ configuradas |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | notificação push (PWA) | ✅ configuradas |
| `CRON_SECRET` | autentica as rotas de cron | ✅ configurada |

### ⚠️ `CRED_SECRET` — a variável mais perigosa da lista

`CRED_SECRET` é a chave que **criptografa todos os tokens de integração** no
banco (`lib/crypto.ts`). Quando ela não existe, `src/lib/env.ts` cai em
silêncio para o `AUTH_SECRET`.

O perigo: **trocar o `AUTH_SECRET` sem ter um `CRED_SECRET` próprio torna
ilegível todo token OAuth já guardado** — Melhor Envio, Nuvemshop, Bling e
Mercado Pago de todas as lojas param de funcionar de uma vez, e cada lojista
precisa reconectar à mão. Definir um `CRED_SECRET` separado elimina esse
acoplamento.

## Conexões por loja (OAuth, guardadas no banco)

Cada loja conecta a **conta dela**. A plataforma só orquestra — o saldo, as
cobranças e as etiquetas saem da conta da lojista.

| Integração | Modelo no banco | Onde a lojista conecta |
|---|---|---|
| Melhor Envio | `MelhorEnvioConnection` | Configurações → Melhor Envio |
| Nuvemshop | `NuvemshopConnection` | Configurações → Integrações |
| Bling | `BlingConnection` | Configurações → Integrações |
| Mercado Pago | `MercadoPagoConnection` | Configurações → Integrações |
| InfinitePay | `InfinitePayConnection` | Configurações → Integrações |

Todos os tokens são gravados **criptografados** e renovados sozinhos.

## Endereços de retorno (OAuth redirect)

Precisam bater **exatamente** com o que está cadastrado no painel de cada
serviço — um caractere diferente e a conexão falha sem explicação:

```
https://www.atacadopro.com/api/melhorenvio/callback
https://www.atacadopro.com/api/nuvemshop/callback
https://www.atacadopro.com/api/bling/callback
https://www.atacadopro.com/api/mercadopago/callback
```

## Deploy e bootstrap

`vercel-build` roda, nesta ordem: guard de crons → guard da documentação →
`prisma migrate deploy` → `prisma/bootstrap.ts` (cria a empresa-plataforma
`vesticrm` e o SUPERADMIN a partir de `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`)
→ `next build`.

Em produção, `src/lib/env.ts` **recusa iniciar** sem `AUTH_SECRET` forte
(≥16 caracteres) — proteção contra subir com segredo público. O seed de
demonstração é bloqueado em produção.

## Infraestrutura própria

- **Servidor Evolution:** VPS Hostinger `srv1853369.hstgr.cloud`, projeto
  Docker `evolução-api-2zk0`. Webhook autenticado por token único por loja.
  Vigiado por `lib/health.ts` (sem cron — de carona no tráfego, ADR-002).
- **Banco:** Neon (Postgres). Local: porta **5433**.
- **Hospedagem:** Vercel. Domínios: `www.atacadopro.com` (app e site),
  `catalago.net` (catálogo público; a raiz redireciona para o site).
- **DNS:** HostGator — registro `A` de `@` → `216.198.79.1` e `CNAME` de `www`
  → `cname.vercel-dns.com`.

## Pendências conhecidas

- **Evolution:** ligar `DATABASE_SAVE_DATA_HISTORIC`, `NEW_MESSAGE`, `CHATS` e
  `CONTACTS` = `true` no compose do servidor e reconectar as lojas. Sem isso a
  importação de histórico devolve ~0 mensagens.
- **Melhor Envio:** parceria/comissão em negociação à parte.
- **Bling:** enquanto o app não existe, a etiqueta com NF-e (ADR-011) fica
  inalcançável — o código está pronto e testado, mas sem nota não há chave.
