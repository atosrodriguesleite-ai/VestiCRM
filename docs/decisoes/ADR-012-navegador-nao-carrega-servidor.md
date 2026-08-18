# ADR-012 — O navegador não carrega código de servidor (e o build local é o da Vercel)

- **Situação:** aceita
- **Regras ligadas:** —
- **Decidida em:** 18/08/2026

## Contexto

Em 17/08/2026 a produção parou de receber deploy. A entrega das tabelas de
preço (RN-018) colocou, na MESMA biblioteca, duas coisas de naturezas
diferentes:

- a regra pura do mínimo do atacado — importada pelo **catálogo público**, que
  roda no NAVEGADOR da cliente;
- o sorteio do código do link (`node:crypto`) e a consulta ao banco.

O build local passou; o da Vercel caiu com `Module build failed: node:crypto`.
Motivo: o script local usava **turbopack**, que engole esse caso, e a Vercel
usa **webpack**, que derruba. Ou seja, "rodei o build e passou" — o passo
obrigatório antes de todo push (ADR-010) — tinha deixado de significar alguma
coisa.

A revisão do dia seguinte mostrou que o problema era maior que o incidente:
duas telas da área logada (`/pedidos/[id]` e `/recompra`) **já empacotavam o
Prisma dentro do navegador** e só não quebravam porque o `@prisma/client` tem
um stub que adia o erro; e o painel de Envio estava a **um import de valor** de
derrubar tudo pela corrente `melhorenvio → nuvemshop → push → web-push →
net/tls`.

## Decisão

1. **Regra pura mora em arquivo próprio.** Função que a tela precisa e que não
   depende de banco, rede ou Node fica num arquivo sem nenhuma dessas
   dependências. O motor de servidor reexporta, para não quebrar quem já
   importava. Exemplos: `lib/nome-provisorio.ts`, `lib/recompra-textos.ts`,
   `lib/catalogo/tabelas-de-preco.ts` (contra `-servidor.ts`).
2. **Tipo compartilhado com tela mora em arquivo de tipos** (ex.:
   `lib/melhorenvio-tipos.ts`). `import type` some na compilação e "funciona",
   mas deixa a armadilha montada para virar import de valor por descuido.
3. **O build local é o mesmo da Vercel** — `next build` sem `--turbopack`.
   Mais lento, e é o preço de a conferência valer alguma coisa.
4. **Um guarda automático vigia isso**, e não por palavra-chave: o teste
   `navegador-sem-servidor.test.ts` parte de TODO componente `"use client"`,
   segue os imports de VALOR e falha se a corrente chegar em `lib/db.ts`,
   `node:*`, `crypto`, `net`, `@prisma/client` e afins — mostrando a corrente
   inteira no erro.

## Consequências

- Build local mais demorado.
- Ao criar função nova, é preciso decidir de saída: pura (tela pode usar) ou de
  servidor. Quando a tela precisar de algo que está no motor, a saída é
  **extrair a parte pura**, nunca importar o motor.
- O guarda por palavra-chave que existia foi substituído: ele passava batido
  com `from "crypto"` (sem o prefixo `node:`), que é justamente como o resto do
  projeto escreve.
