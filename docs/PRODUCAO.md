# Produção — deploy, variáveis e migrações

Como o AtacadoPro chega no ar e como evoluir sem derrubar as lojas.

> ⚠️ **Não existe ambiente de homologação.** Push na branch de deploy
> (`claude/modacrm-clothing-crm-cxa9gf`) vira produção em ~3 minutos, sozinho.
> Rode `npm test` e `npm run build` antes. Sempre.

---

## 1. Como o deploy acontece

A Vercel observa a branch de deploy e roda `npm run vercel-build`, que executa
**nesta ordem**:

```
scripts/check-vercel-crons.mjs   →  guard dos cron jobs (falha o build se violar)
scripts/migrate-deploy.mjs       →  prisma migrate deploy, com destravador de P3009
prisma/bootstrap.ts              →  cria a empresa-plataforma e o Super Admin (idempotente)
next build                       →  build da aplicação
```

Se qualquer passo falhar, o deploy falha e o site continua na versão anterior —
que é o comportamento desejado.

### O guard de crons (leia isto antes de mexer em `vercel.json`)

A Vercel no plano **Hobby** aceita no máximo **2 cron jobs, cada um rodando no
máximo 1x por dia**. Passar disso faz a Vercel **bloquear TODOS os deploys, em
silêncio** — sem e-mail, sem erro visível. Já travou o deploy duas vezes.

`scripts/check-vercel-crons.mjs` roda antes do build e falha alto se:
- houver mais de 2 crons;
- algum cron tiver `*`, `,`, `-` ou `/` no minuto ou na hora (ou seja, rodar
  mais de uma vez por dia).

Os 2 slots hoje são do `jueri-sync` (06:00 e 15:00 UTC).

**Precisa de trabalho periódico? Não crie cron.** Ou junte a tarefa num endpoint
que já existe, ou pegue carona no tráfego — é o que `src/lib/health.ts` faz para
monitorar o sistema inteiro sem consumir um slot.

### O destravador de migração (P3009)

Quando uma migração falha no meio contra o banco de produção, o Postgres a
desfaz inteira, mas o Prisma grava "falhou" na tabela de controle — e a partir
daí **todo deploy morre na hora com P3009**, sem nem tentar. O site fica preso
até alguém destravar à mão.

`scripts/migrate-deploy.mjs` destrava sozinho, mas de forma deliberadamente
**estreita**:

- só migrações de uma **lista fechada** no topo do arquivo (escritas para rodar
  duas vezes, com `IF NOT EXISTS` em tudo);
- só quando o carimbo é "rolled back" de verdade;
- **uma** nova tentativa.

Migração antiga que falhar **nunca** é destravada automaticamente — re-rodar SQL
não-idempotente em produção é pior que o deploy parado.

Escreveu uma migração nova e reexecutável? Adicione o nome dela à constante
`REEXECUTAVEIS`.

---

## 2. Variáveis de ambiente

**A fonte da verdade é o [`.env.example`](../.env.example)** — 114 linhas
documentando cada uma das 30+ variáveis: o que faz, se é obrigatória e o que
quebra sem ela. Mantenha esse arquivo atualizado quando adicionar uma env nova;
ele já ficou documentando 3 variáveis enquanto o código lia mais de 30, e quem
foi configurar produção não tinha como saber o que faltava.

Em produção os valores vivem na **Vercel** (Settings → Environment Variables).
Nunca em commit, nunca em chat.

### Obrigatórias

| Variável | Observação |
| --- | --- |
| `DATABASE_URL` | Postgres de produção (Neon). |
| `AUTH_SECRET` | Segredo das sessões, mín. 16 caracteres. Gere: `openssl rand -base64 32`. A aplicação **recusa iniciar** em produção com segredo fraco (`src/lib/env.ts`, fail-fast). |
| `INTAKE_SECRET` | Protege `/api/intake/*` e o webhook simulado. **Sem ela essas rotas respondem 503** — é fail-closed de propósito ([`INCIDENTES.md`](INCIDENTES.md) #10). |
| `CRON_SECRET` | Protege `/api/cron/*`. |

### Importantes

`CRED_SECRET` (criptografa credenciais de integração; usa `AUTH_SECRET` se
ausente), `APP_URL`, `CATALOG_DOMAIN`, `MAIN_SITE_URL`, `EVOLUTION_URL`,
`EVOLUTION_KEY`, `VAPID_*` (push PWA), `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD`
(usados **uma vez** pelo bootstrap).

### Das integrações

`MP_CLIENT_ID` / `MP_CLIENT_SECRET` / `PLATFORM_FEE_PCT`, `BLING_*`,
`MELHOR_ENVIO_*`, `NUVEMSHOP_*`. Ver o estado de cada uma em
[`ESTADO-DO-PROJETO.md`](ESTADO-DO-PROJETO.md).

> A **InfinitePay** não usa env da plataforma: cada loja liga a própria
> InfiniteTag em Configurações, guardada criptografada no banco.

---

## 3. Migrações

### São escritas à mão. Sempre.

O banco tem drift em relação ao `schema.prisma`, e `prisma migrate dev` gera
lixo — o caso conhecido é um `ALTER` no default de `Customer.linkCode`, que deve
ser **removido de qualquer diff** onde apareça.

```bash
# 1. edite prisma/schema.prisma (comente o campo em português)
# 2. crie a pasta e escreva o SQL:
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_descricao_curta
$EDITOR prisma/migrations/*_descricao_curta/migration.sql
# 3. aplique em local e confira
npm run db:deploy && npx prisma generate && npm test
```

### Escreva sempre reexecutável

Sua migração vai rodar **com lojas gravando dado no meio**. Duas regras que
nasceram de incidente ([`INCIDENTES.md`](INCIDENTES.md) #12):

1. **`IF NOT EXISTS` em tudo.** Se a migração cair no meio e for reexecutada,
   ela não pode quebrar em "coluna já existe".
2. **`DEFAULT` antes de preencher.** Se você vai fazer `SET NOT NULL` numa
   coluna nova, defina o `DEFAULT` **primeiro** — senão uma linha criada
   *durante* a migração nasce sem valor e o `SET NOT NULL` falha.

### O que é seguro e o que não é

- ✅ **Aditivo** (nova tabela, nova coluna com default) — seguro.
- ⚠️ **Destrutivo** (renomear ou remover coluna) — faça em três entregas:
  adiciona → migra os dados → remove numa próxima.
- 🚫 **`npm run db:seed` em produção** — zera e duplica dados de lojas reais.
  Existe uma trava (`ALLOW_PROD_SEED`), mas nunca aponte o `DATABASE_URL` de
  produção para o seed.

---

## 4. Antes de subir

```
[ ] npm test          — passou inteiro
[ ] npm run build     — passou (inclui o guard de crons)
[ ] /code-review nível high, achados confirmados corrigidos
[ ] mexeu em dinheiro, estoque ou algo que conclui/apaga sozinho?
    → reproduza o cenário ponta a ponta contra o Postgres local
[ ] migração nova é reexecutável e está na lista REEXECUTAVEIS (se for o caso)
```

---

## 5. Quando algo quebrar em produção

1. **Painel `/saude`** (Super Admin) — erros capturados por
   `src/instrumentation.ts` (`onRequestError`), com rota, mensagem e frequência.
   Foi ele que "deu nome aos bois" no incidente do romaneio.
2. **Logs da Vercel** — Deployments → o deploy → Runtime Logs.
3. **Estado do WhatsApp** — `src/lib/health.ts` checa o servidor Evolution e a
   conexão de cada loja, de carona no tráfego, e alerta por sino e push.

O sistema é multi-tenant: cada loja só enxerga os próprios dados (`companyId` em
toda consulta, filtros em `src/lib/scope.ts`). Ao investigar um problema de uma
loja, use a **impersonação** do Super Admin — ela mostra exatamente o que a loja
vê, com faixa âmbar no topo indicando que você não é ela.
