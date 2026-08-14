# Primeiro dia no AtacadoPro

Guia para quem está assumindo este código. Leia inteiro antes de escrever a
primeira linha — leva uns 20 minutos e economiza uma semana.

---

## 0. As três coisas que você precisa saber antes de tudo

**1. Isto está em produção, com lojas reais pagantes.** Toque Leve, Entre
Linhas e outras rodam o dia delas aqui dentro. Não é um projeto pessoal.

**2. Não existe homologação.** Push na branch de deploy vira produção em ~3
minutos, sozinho, pela Vercel. Não há botão de "publicar" nem revisão humana no
meio. Se quebrou, quebrou pra loja da cliente.

**3. O dono do produto não é técnico.** Ele descreve problema em linguagem de
negócio ("o pedido da Lara caiu no painel da Juliana") e espera resposta na
mesma língua. Se você só sabe explicar em termos de `sellerId` e `ownerId`,
ainda não entendeu o suficiente.

---

## 1. Colocar o sistema pra rodar

### O que você precisa

- **Node 20+** (o projeto não declara `engines`; use 20 ou 22)
- **PostgreSQL 16** — local, na porta **5433** (não é a 5432 padrão)
- `git`

### Passo a passo

```bash
git clone <repo> && cd VestiCRM
npm install
```

Suba o banco. Em ambiente Linux com Postgres instalado, o script faz tudo
(cria o cluster, inicia na 5433, cria o banco `vesticrm`):

```bash
bash scripts/dev-postgres.sh
```

Ele imprime a connection string no final. Exporte-a junto com o segredo de
sessão:

```bash
export DATABASE_URL="postgresql://vesti@127.0.0.1:5433/vesticrm?schema=public"
export AUTH_SECRET="qualquer-coisa-com-mais-de-16-caracteres"
```

> Em produção o sistema **recusa iniciar** com `AUTH_SECRET` fraco (`src/lib/env.ts`,
> fail-fast). Em local qualquer string de 16+ caracteres serve.

Crie o schema e popule a loja de demonstração:

```bash
npm run db:deploy    # aplica as 88 migrações versionadas
npm run db:seed      # cria a loja demo "Bella Moda" com dados completos
npm run dev          # http://localhost:3000
```

### Confira que deu certo

```bash
npm test             # os 106 arquivos de teste devem passar
npm run build        # deve passar pelo guard de crons e compilar
```

Entre com `ana@bellamoda.com.br` / `demo1234`. Você deve cair no Dashboard com
clientes, produtos e pedidos.

Para ver o **isolamento multi-tenant** funcionando — que é a promessa central do
produto — saia e entre com `marcos@urbanstyle.com.br` / `demo1234`. É outra
loja: nada do que você viu antes existe.

Para ver a diferença de papéis, entre com `julia@bellamoda.com.br` (vendedora):
ela enxerga só a carteira dela.

### As variáveis de ambiente

O [`.env.example`](../.env.example) tem 114 linhas comentando **cada uma** das
30+ variáveis: o que faz, se é obrigatória e o que quebra sem ela. Só
`DATABASE_URL` e `AUTH_SECRET` são obrigatórias para rodar local — as outras
ligam integrações (WhatsApp, Mercado Pago, Bling, Melhor Envio, Nuvemshop).

**Segredo nunca entra em commit nem em chat.** Em produção vivem na Vercel; as
credenciais das lojas ficam criptografadas no banco (AES-256-GCM,
`src/lib/crypto.ts`).

---

## 2. Como o sistema pensa

### Multi-tenant: `companyId` em toda query

Cada loja é uma `Company`. **Toda** consulta ao banco filtra por `companyId`.
Não é convenção de estilo — é a promessa que o produto vende. Uma loja ver dado
de outra é o pior incidente possível aqui.

Os filtros prontos vivem em `src/lib/scope.ts`:

```ts
tenant(user)              // { companyId: user.companyId } — o filtro base
orderScope(user)          // vendedora vê só os pedidos dela; gerente+ vê a loja
conversationScope(user)   // idem para conversas do WhatsApp
taskScope(user)           // idem para tarefas
ownedScope(user)          // idem para a carteira de clientes
```

Se você escreveu um `db.<algumaCoisa>.findMany` sem `companyId`, pare e volte.

### Papéis

| Papel | O que enxerga |
| --- | --- |
| `SUPERADMIN` | A plataforma inteira. Pode "acessar como loja" (impersonação, com faixa amarela no topo). |
| `ADMIN` | A loja inteira + gestão de usuários. |
| `MANAGER` | A loja inteira, comercialmente. |
| `SELLER` | **Só a própria carteira** — clientes, pedidos, conversas e tarefas dela. |
| `SUPPORT` | Operacional (integrações), sem poderes comerciais. |

### As camadas

```
tela (.tsx)  →  rota (/api/**/route.ts)  →  motor (src/lib/*.ts)  →  banco (Prisma)
```

- **Tela não sabe regra.** Se tem `if` de negócio num `.tsx`, está no lugar errado.
- **Rota valida e delega.** Zod para o formato, `requireUser` para a identidade,
  motor para a decisão.
- **Motor decide.** É onde vive tudo que importa: estoque, comissão, atribuição,
  faturamento. E é onde ficam os testes.

### Três porteiros, não um

Nem toda rota usa `requireUser`. Os módulos gated têm o seu:

| Helper | Onde | Arquivo |
| --- | --- | --- |
| `requireUser()` | Rotas gerais | `src/lib/auth.ts` |
| `requireProducao()` | `/api/producao/*` | `src/lib/producao-auth.ts` |
| `requirePlanoCorte()` | `/api/plano-corte/*` | `src/lib/plano-corte-auth.ts` |

Eles conferem **também** se a loja contratou o módulo (`CompanyModule`). Rotas
realmente públicas por desenho: catálogo, bio, webhooks (autenticados por token
na URL), `/api/track/*`, `/api/img/[id]` e os callbacks de OAuth.

---

## 3. Sua primeira mudança

### Receita: criar uma rota de API

Copie o formato de `src/app/api/customers/route.ts`. O esqueleto é sempre este:

```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser, AuthError } from "@/lib/auth";

const schema = z.object({ /* … */ });

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();                    // 1. quem é
    const parsed = schema.safeParse(await req.json());   // 2. formato válido?
    if (!parsed.success) {
      return NextResponse.json({ error: "Dados inválidos" }, { status: 400 });
    }
    // 3. SEMPRE com companyId — inclusive ao validar ids que vieram do cliente
    const algo = await db.algo.findFirst({
      where: { id: parsed.data.algoId, companyId: user.companyId },
    });
    // 4. a decisão de negócio mora em src/lib, não aqui
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
    throw e;
  }
}
```

O passo 3 tem uma armadilha clássica: **todo id que chega do navegador precisa
ser confirmado como sendo da loja do usuário** antes de ser usado. Sem isso, um
usuário mal-intencionado passa o id de outra loja e o sistema obedece.

### Receita: mudar o banco

**As migrações são escritas à mão.** O banco tem drift em relação ao schema, e
`prisma migrate dev` gera lixo — o caso conhecido é um `ALTER` no default de
`Customer.linkCode`, que deve ser removido de qualquer diff onde apareça.

```bash
# 1. edite prisma/schema.prisma (comentando o campo em português)
# 2. crie a pasta e o SQL na mão:
mkdir -p prisma/migrations/$(date +%Y%m%d%H%M%S)_descricao_curta
$EDITOR prisma/migrations/*_descricao_curta/migration.sql
# 3. aplique em local e confira
npm run db:deploy
npx prisma generate
```

Prefira mudanças **aditivas** (nova tabela, nova coluna com default). Remover ou
renomear coluna com loja rodando exige três etapas: adiciona → migra os dados →
remove numa entrega posterior.

### Receita: escrever teste

Testes vivem em `src/lib/__tests__/`, com nome **da regra**, não do arquivo:
`reserva-sem-prazo.test.ts`, `pedido-nao-duplica.test.ts`,
`faturamento-data.test.ts`. Rodam com `npm test` (vitest).

Ao consertar um bug de negócio, **deixe o teste**. Foi assim que 13 mil linhas
de teste viraram a rede de segurança que permite mexer em dinheiro sem medo.

---

## 4. Checklist antes de todo push

```
[ ] npm test          — passou inteiro
[ ] npm run build     — passou (inclui o guard de crons)
[ ] /code-review nível high, e os achados confirmados corrigidos
[ ] mexeu em dinheiro, estoque, ou algo que apaga/conclui dado sozinho?
    → reproduza o cenário ponta a ponta contra o Postgres local antes de subir
[ ] a mensagem do commit explica o problema DE NEGÓCIO, não o arquivo mexido
```

A revisão especialista virou regra permanente em 09/08/2026 por um motivo
concreto: uma revisão de código já "pronto" achou **10 bugs**, e 3 deles
escondiam dinheiro pendente. Caso de canto — dois pedidos, compromisso futuro,
status raro — é exatamente o que o autor não vê no próprio código.

Exceção: mudança trivial sem lógica (texto, cor, label).

### Como escrevemos commits

Olhe `git log`. O padrão é descrever o **efeito para a loja**:

```
Catálogo: o pedido não se perde mais no caminho
Cancelamento: o vendedor decide se as peças voltam ao estoque
Romaneio não cai mais por causa de emoji (erro 500 na Entre Linhas #0137)
```

E não `fix: handle emoji in romaneio`. O histórico é lido por quem precisa
entender o que mudou pra cliente.

---

## 5. Os oito lugares onde você vai errar

Todos já aconteceram. O detalhe está em [`INCIDENTES.md`](INCIDENTES.md).

1. **Somar `total` em vez de `netTotal`** numa métrica de faturamento. `total`
   tem frete; frete não é venda.
2. **Usar o modelo `Sale`** achando que é a venda. É legado do fluxo manual.
   Venda é `Order` com status em `PAID_ORDER_STATUSES`.
3. **Esquecer o `companyId`** numa query nova, ou aceitar um id vindo do
   navegador sem conferir de quem ele é.
4. **Adicionar um terceiro cron** na `vercel.json`, ou um cron não-diário. O
   plano Hobby aceita 2, diários. O terceiro **bloqueia todos os deploys, sem
   avisar**. O guard `scripts/check-vercel-crons.mjs` te salva no build.
5. **Rodar `db:seed` apontando para produção.** Zera dados de lojas reais.
6. **Confiar no `prisma migrate dev`.** Escreva o SQL à mão.
7. **Engolir erro com `.catch(() => {})`.** Foi assim que pedidos do catálogo
   sumiram: a mensagem chegava no WhatsApp da vendedora e o pedido não existia.
8. **Assumir que o sync do WhatsApp entrega a conversa inteira.** Ele entrega o
   **parcial** — a última mensagem de cada conversa. Quem tratou como completo
   fez sumir o histórico da tela.

---

## 6. "Quero mexer em X — onde fica?"

| Quero mexer em… | Vá em |
| --- | --- |
| Regra de pedido, status, totais | `src/lib/orders.ts` |
| Reserva e baixa de estoque | `src/lib/reservations.ts` |
| Quem vê o quê (papéis, carteira) | `src/lib/scope.ts` |
| Entrada de lead (qualquer canal) | `src/lib/intake.ts` |
| Envio/recebimento de WhatsApp | `src/lib/comm/` |
| Tela do WhatsApp | `src/app/(app)/whatsapp/inbox.tsx` ⚠️ 3.4k linhas |
| Pedido vindo do catálogo público | `src/lib/catalogo/envio-pedido.ts` |
| "Colar pedido do WhatsApp" | `src/lib/catalogo/ler-mensagem.ts` |
| Pix / confirmação de pagamento | `src/lib/settle-order.ts`, `mercadopago.ts`, `infinitepay.ts` |
| NF-e | `src/lib/bling.ts` |
| Frete e etiqueta | `src/lib/melhorenvio.ts` |
| Estoque vindo da Nuvemshop | `src/lib/nuvemshop.ts` ⚠️ 1.3k linhas |
| Métricas do catálogo | `src/lib/tracking/insights.ts` |
| Provisionar uma loja nova | `src/lib/provision.ts` |
| Monitoramento / painel Saúde | `src/lib/health.ts`, `src/instrumentation.ts` |
| Cores, botões, componentes de UI | `src/components/ui.tsx` + `DESIGN_NOTES.md` |

---

## 7. Glossário do domínio

O código mistura inglês (herança do Prisma) e português (o que o negócio fala).

| Termo | Significa |
| --- | --- |
| **Loja / tenant** | `Company`. Cada cliente pagante do SaaS. |
| **Carteira** | Conjunto de clientes de uma vendedora (`Customer.ownerId`). |
| **Funil** | `Pipeline` + `Stage` + `Opportunity`. O kanban de vendas. |
| **Orçamento** | `Order` com status `ORCAMENTO`. Já **reserva** estoque. |
| **Romaneio** | Lista de separação do pedido, agrupada por categoria → produto → cor → tamanho. |
| **Baixa definitiva** | Cancelar sem devolver estoque (perda/brinde/defeito) — `Order.stockWrittenOff`. |
| **`?ref=`** | Link da vendedora no catálogo. Quem mandou o link leva a venda. |
| **Empresa-plataforma** | A `Company` de slug `vesticrm` — onde o Super Admin opera e caem os leads do site. |
| **Impersonação** | Super Admin entrando numa loja cliente, com faixa âmbar no topo. |
| **Módulo gated** | Recurso que a loja contrata à parte (`CompanyModule`): Produção, Envios, Marketing, Plano de Corte, Biblioteca, Inteligência. |
| **Evolution** | Servidor self-hosted que fala com o WhatsApp não-oficial. |

---

## 8. Quanto tempo até você ficar confortável

Estimativa honesta, para alguém sênior em Next.js + TypeScript + Prisma:

- **Dia 1** — ambiente rodando, navegando pelo sistema com os 3 logins.
- **Semana 1** — consegue fazer uma mudança pequena com segurança (uma tela, um
  campo, um relatório).
- **Mês 1** — produtivo em **uma** área (ex.: catálogo, ou WhatsApp, ou pedidos).
- **Mês 3** — confiável em dinheiro e estoque.

O obstáculo não é a dificuldade do código — é a **amplitude**. São oito produtos
num repositório só. Escolha uma área e domine antes de espalhar.

---

## 9. Onde continuar lendo

1. [`CLAUDE.md`](../CLAUDE.md) — as regras de negócio centrais, em detalhe. É o
   documento mais denso e mais valioso do repositório.
2. [`INCIDENTES.md`](INCIDENTES.md) — o que já quebrou e por quê.
3. [`ESTADO-DO-PROJETO.md`](ESTADO-DO-PROJETO.md) — o que está no ar hoje e o
   que está pendente.
4. [`PRODUCAO.md`](PRODUCAO.md) — deploy, envs e migrações.
