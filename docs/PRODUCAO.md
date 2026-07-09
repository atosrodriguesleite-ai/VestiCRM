# Colocar o VestiCRM em produção

Guia enxuto para publicar o sistema com segurança e continuar evoluindo sem
impactar os clientes.

## 1. Banco de dados (PostgreSQL)

O sistema usa **PostgreSQL** (dev e produção). Contrate um banco gerenciado —
ex.: [Neon](https://neon.tech), [Supabase](https://supabase.com) ou
[Railway](https://railway.app) — e copie a connection string.

```
DATABASE_URL="postgresql://user:senha@host/vesticrm?sslmode=require"
```

## 2. Variáveis de ambiente (no host)

| Variável        | Obrigatória | Observação                                             |
| --------------- | ----------- | ------------------------------------------------------ |
| `DATABASE_URL`  | ✅          | String do Postgres de produção.                        |
| `AUTH_SECRET`   | ✅          | Segredo das sessões. Gere: `openssl rand -base64 32`.  |
| `CRED_SECRET`   | opcional    | Criptografa credenciais de integração; usa AUTH se ausente. |

Em produção, a aplicação **recusa iniciar** sem `AUTH_SECRET` forte (≥16
caracteres) — proteção contra subir com segredo público.

## 3. Preparar o banco (só na 1ª vez / a cada mudança de schema)

```bash
npm run db:deploy   # aplica as migrações versionadas (prisma migrate deploy)
```

> Nunca rode `npm run db:seed` em produção — ele é de demonstração e **apaga
> todo o banco**. Há uma trava que bloqueia isso quando `NODE_ENV=production`.

## 4. Build e start

```bash
npm run build
npm run start
```

Em plataformas serverless (Vercel etc.), aponte o build para `npm run build` e
rode `npm run db:deploy` no passo de release.

## 5. Evoluir o sistema SEM impactar os clientes

- **Novas telas/recursos**: seguem normais — não tocam nos dados dos clientes.
- **Mudanças no banco**: sempre com migração versionada.
  1. altere `prisma/schema.prisma`;
  2. `npm run db:migrate -- --name descricao` (gera a migração em dev);
  3. teste;
  4. em produção, `npm run db:deploy` aplica a mudança sem apagar dados.
- **Mudanças aditivas** (novas tabelas/colunas) são seguras.
- **Mudanças destrutivas** (renomear/remover coluna) exigem cuidado — faça em
  etapas (adiciona → migra dados → remove depois).
- **Recomendado**: manter um ambiente de **staging** (banco separado) para
  testar antes de publicar para os clientes.

## 6. Isolamento entre clientes

O sistema é multi-tenant: cada loja só enxerga os próprios dados (filtro por
`companyId` em todas as consultas). Uma loja nunca vê dados de outra.
