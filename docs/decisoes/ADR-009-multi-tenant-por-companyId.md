# ADR-009 — Isolamento entre lojas por `companyId`, centralizado em `scope.ts`

- **Situação:** aceita
- **Regras ligadas:** RN-007, RN-013
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

Lojas concorrentes vivem no mesmo banco. Um vazamento entre duas lojas de
atacado não é bug: é o fim do produto. E a régua de visibilidade tem duas
camadas, não uma:

- **entre lojas** — a Toque Leve nunca vê nada da Entre Linhas;
- **dentro da loja** — a vendedora vê só a carteira e os pedidos dela.

## Decisão

1. **Toda query filtra por `companyId`.** Sem exceção.
2. Os filtros ficam **centralizados em `src/lib/scope.ts`** — nenhuma rota
   escreve o filtro à mão. Filtro copiado e colado é filtro que um dia é
   esquecido.
3. `orderScope(user)` resolve a segunda camada: vendedora vê só os pedidos com
   o `sellerId` dela; gerente, admin e suporte veem a loja inteira.
4. A régua vale em **toda porta**, não só na lista: ficha, PDFs, Pix, NF-e,
   frete, transferência, declaração de conteúdo e exportação. Rota que devolve
   dado de pedido sem passar pelo escopo é bug de segurança.
5. Papéis: SUPERADMIN (plataforma), ADMIN, MANAGER, SELLER (só a própria
   carteira), SUPPORT (operacional, sem poderes comerciais).
6. O Super Admin pode "acessar como loja" (impersonação) — sempre com **faixa
   amarela** visível, para ninguém esquecer onde está.

## Consequências

- ✅ Auditar isolamento é ler um arquivo, não 130 rotas.
- ✅ Rota nova herda a régua de graça, se usar o helper.
- ⚠️ Query escrita fora do helper (SQL cru, agregação) precisa de atenção
  redobrada na revisão — é o único lugar onde o vazamento pode nascer.

## Verificação

Auditoria de segurança rota a rota concluída em 24/07/2026. Os testes
`escopo-apis-*.test.ts` guardam o resultado.
