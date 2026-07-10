# Estado do projeto — AtacadoPro (resumo para continuidade)

> Leia este arquivo ao iniciar uma nova sessão para retomar o contexto.
> Toda a conversa é em **português (Brasil)** e o interlocutor é o **operador
> da plataforma (não técnico)** — explique de forma simples e guie clique a
> clique quando for mexer em serviços externos (Vercel/Neon).

## O que é
**AtacadoPro** — SaaS de CRM para **lojas de moda** que vendem pelo WhatsApp:
atendimento omnichannel, catálogo personalizável, pedidos, funil e
inteligência comercial. Multi-tenant (cada loja isolada por `companyId`).

## Stack
- Next.js 15 (App Router) + React 19 + **TypeScript**
- Prisma 6 + **PostgreSQL** (migrações versionadas em `prisma/migrations`)
- Tailwind v4 · JWT (jose) · vitest (52 testes)
- Branch de desenvolvimento: **`claude/modacrm-clothing-crm-cxa9gf`**

## Já está NO AR (produção)
- **Hospedagem:** Vercel (deploy automático a cada push na branch).
- **Banco:** Neon (PostgreSQL, região São Paulo).
- **Deploy self-service:** o script `vercel-build` roda `prisma migrate deploy`
  + `prisma/bootstrap.ts` (cria a empresa-plataforma + o SUPERADMIN a partir de
  `SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`) + `next build`.
- **Variáveis de ambiente na Vercel:** `DATABASE_URL`, `AUTH_SECRET`,
  `SUPERADMIN_EMAIL` (= atosrodriguesleite@gmail.com), `SUPERADMIN_PASSWORD`.
- **Segurança:** `src/lib/env.ts` exige segredo forte em produção (fail-fast);
  o seed de demonstração é bloqueado em produção.

## Arquitetura-chave (decisões já tomadas)
- **Empresa-plataforma** (slug `vesticrm`): onde o Super Admin opera; recebe os
  **leads da Landing Page** (`/api/demo` → Lead Intake Engine, origem SITE) no
  pipeline "Leads do Site".
- **Super Admin** loga e cai em **/lojas = "Painel do Super Admin"** (gestão
  das lojas clientes + resumo de leads do site). Não vê o CRM de varejo por
  padrão.
- **Provisionar loja:** `src/lib/provision.ts` + página `/lojas` ("Nova loja")
  cria empresa + admin + funil de moda + cores/tamanhos, sem apagar nada.
- **"Acessar loja"** (impersonação): Super Admin entra em qualquer loja com
  acesso total (faixa âmbar no topo + "Voltar ao Super Admin").
  `src/app/api/impersonate/*`, claim `imp` assinado no JWT.
- **Importar catálogo:** `src/lib/catalog-import.ts` + `/api/catalog/import` +
  botão em Produtos. Formato do arquivo em `docs/IMPORTAR-CATALOGO.md`.
  Estoque resolvido por prioridade (stockByVariant › produto.stock ›
  defaults.stock › 0). `maxDuration=60` na rota (arquivos grandes com fotos).

## Onde parei / próximos passos
- **WhatsApp 100% dentro do sistema (adiado, decidido em 10/07/2026):**
  integrar a **WhatsApp Cloud API oficial** — a fundação já existe
  (Conversas, Lead Intake com rodízio/SLA, `/api/whatsapp/webhook`, modo
  simulado). Plano: piloto com o número do operador antes de liberar às lojas.

- **Em andamento:** subir a **primeira loja real (Toque Leve)**. O catálogo já
  foi convertido do HTML original para o formato de importação (20 produtos =
  4 modelos × 5 cores, P/M/G/GG, estoque 5, 41 fotos embutidas). O operador vai
  criar a loja "Toque Leve" e importar o arquivo.
- **Oferecido, aguardando decisão:** enxugar o **menu lateral** para o Super
  Admin quando ele NÃO está dentro de uma loja (mostrar só Lojas / Leads do
  site / Configurações; menu completo só ao "Acessar loja").
- **Futuro (opcional):** por segurança, resetar a senha do banco no Neon e
  atualizar `DATABASE_URL` na Vercel (a senha apareceu no chat durante o setup);
  domínio próprio (ex.: `app.vesticrm.com.br`).

## Como rodar localmente (ambiente efêmero)
```bash
bash scripts/dev-postgres.sh   # sobe Postgres local (porta 5433)
export DATABASE_URL="postgresql://vesti@127.0.0.1:5433/vesticrm?schema=public"
npm run db:deploy && npm run db:seed
npm run dev
```
Logins demo (senha `demo1234`): `ana@bellamoda.com.br` (admin loja),
`super@vesticrm.com.br` (Super Admin).
