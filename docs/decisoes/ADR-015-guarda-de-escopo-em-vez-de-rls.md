# ADR-015 — Guarda de escopo no build, em vez de RLS no Postgres

**Data:** 29/08/2026 · **Situação:** aceita

## Contexto

A RN-013 manda toda consulta filtrar por `companyId`. É o que impede uma loja
de ver os dados de outra, e vale desde o primeiro dia. O problema não é a
regra — é ela depender de ninguém esquecer. São 902 consultas em modelos com
`companyId`; basta uma nova nascer sem o filtro para a Toque Leve enxergar a
Entre Linhas. A auditoria de 24/07/2026 conferiu rota a rota, mas auditoria é
foto do dia: não protege o código de amanhã.

A resposta clássica é **RLS** (Row Level Security): a trava mora DENTRO do
Postgres e, mesmo que o código erre, o banco recusa entregar a linha.

## Decisão

Não ligar RLS agora. Em lugar dele, um **guarda que roda no build**
(`escopo-tenant.test.ts`, RN-027): ele varre o código, encontra consulta em
modelo com `companyId` que não filtra por loja e **derruba o build**.

Quem tiver um caso legítimo declara o motivo na linha com `escopo-ok:` — a
mesma convenção do `frete-ok` da RN-002.

O guarda nasce com uma **linha de base** (a conta de hoje por arquivo, 261
casos) e cobra só o que vier depois. A conta pode DESCER e nunca subir.

## Por quê

**RLS de verdade custaria caro aqui.** O Prisma abre conexão por um pool
(Neon), e RLS precisa saber QUEM está perguntando a cada consulta — o que
exige amarrar uma sessão de banco a cada requisição (`SET LOCAL`), com
transação explícita em toda leitura. Isso mexe em todas as consultas e
no jeito como o app fala com o banco. Mudança desse tamanho, num sistema com
lojas reais pagando, tem chance real de derrubar tela em produção — para
proteger contra um erro que ainda não aconteceu.

**O guarda pega o mesmo erro mais cedo e sem risco.** RLS barra o erro em
produção, com a loja já vendo tela quebrada; o guarda barra no build, antes
de existir. Custo de rodar: zero risco para quem está vendendo agora.

**A linha de base é o que torna isto entregável.** Havia 261 consultas sem
filtro explícito quando o guarda nasceu, quase todas legítimas (filtram pelo
PAI já conferido — `where: { orderId: order.id }`, com o pedido buscado
dentro da loja). Anotar as 261 num empurrão só seria uma mexida grande e
apressada em 109 arquivos — exatamente o tipo de coisa que gera o bug que ela
queria evitar. Com a linha de base, o guarda vale desde HOJE para todo código
novo, e a dívida velha encolhe no ritmo de quem passar por ela.

## O que isto NÃO resolve

O guarda lê o código, não o banco. Ele não protege contra acesso direto ao
Postgres com as credenciais em mãos — nem RLS protegeria, contra o dono das
credenciais. E não substitui a RN-013: continua sendo obrigação de quem
escreve filtrar pela loja.

## Quando revisar

Se um dia sairmos do Prisma, ou se o guarda passar a ser desligado com
`escopo-ok` sem motivo real, a conversa do RLS volta.
