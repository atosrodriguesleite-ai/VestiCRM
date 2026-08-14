# ADR-001 — Migrações de banco escritas à mão

- **Situação:** aceita
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

O banco de produção tem *drift*: o estado real das tabelas não bate exatamente
com o histórico de migrações. Isso é herança dos primeiros meses do projeto.

Quando se roda `prisma migrate dev`, o Prisma compara o schema com o banco e
gera SQL para "consertar" o que ele acha que está diferente. Com drift, esse
SQL vem com alterações que ninguém pediu — a mais conhecida é o `ALTER` que
tira o default de `Customer.linkCode`, que **quebra a criação de cliente**.

## Decisão

Toda migração é escrita à mão em `prisma/migrations/<timestamp>_<nome>/migration.sql`.

Regras práticas:

- SQL idempotente sempre que possível (`ADD COLUMN IF NOT EXISTS`) — uma
  migração que aplicou pela metade em produção precisa poder rodar de novo;
- nunca copiar a saída de `prisma migrate dev` sem ler linha por linha;
- se aparecer o `ALTER` do default de `Customer.linkCode`, **remover**;
- produção aplica sozinha no deploy, via `vercel-build` → `prisma migrate deploy`.

## Consequências

- ✅ Nenhuma migração surpresa derruba produção.
- ✅ O SQL fica legível e revisável (é o que os revisores leem primeiro).
- ⚠️ É preciso lembrar de escrever o SQL **e** atualizar o `schema.prisma` — os
  dois andam juntos, e esquecer um dos lados quebra o build ou o banco.

## Alternativas descartadas

- **Resetar o banco para acabar com o drift:** existem lojas reais pagantes com
  dados dentro. Está fora de questão.
- **`prisma db push`:** não gera histórico de migração, e produção precisa do
  histórico para aplicar em ordem.

## Incidente relacionado

Uma migração não idempotente aplicou pela metade e **bloqueou todos os deploys**
até ser reescrita com `IF NOT EXISTS` (agosto/2026).
