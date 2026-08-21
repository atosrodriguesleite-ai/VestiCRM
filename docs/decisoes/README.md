# Decisões de arquitetura (ADRs)

Um ADR responde a pergunta que o código **nunca** responde sozinho:
*por que foi feito assim, e o que já foi descartado?*

O código mostra o **que** ele faz. Ler o código nunca revela que
`prisma migrate dev` foi banido porque gera lixo, nem que a soltura
automática de estoque em 48h existiu e causou incidente. Sem isso, a decisão é
refeita do zero — e o erro volta.

## Quando escrever um ADR

Escreva quando a decisão **restringe o futuro**: uma escolha de arquitetura, um
limite de plataforma, um risco assumido de propósito, ou uma alternativa
óbvia que foi descartada por um motivo não óbvio.

Não escreva para decisão trivial ou reversível em cinco minutos.

## Regras dos números

- Número **nunca** é reaproveitado e **nunca** é renumerado.
- ADR que deixa de valer não é apagado: vira
  `**Situação:** revogada em MM/AAAA, substituída pelo ADR-0XX`.
- O arquivo é `ADR-0XX-titulo-curto.md` e entra na lista abaixo.

## Lista

| ID | Decisão | Situação |
|---|---|---|
| [ADR-001](ADR-001-migracoes-a-mao.md) | Migrações de banco escritas à mão | aceita |
| [ADR-002](ADR-002-limite-de-crons.md) | No máximo 2 crons diários; o resto de carona no tráfego | aceita |
| [ADR-003](ADR-003-fotos-como-data-url.md) | Fotos e mídias como data-URL no banco | aceita com prazo |
| [ADR-004](ADR-004-faturamento-netTotal.md) | Faturamento soma `netTotal`, nunca `total` | aceita |
| [ADR-005](ADR-005-reserva-de-estoque.md) | O orçamento reserva estoque, e a reserva não tem prazo | aceita |
| [ADR-006](ADR-006-atribuicao-por-link.md) | Quem mandou o link leva a venda, e só ele | aceita |
| [ADR-007](ADR-007-whatsapp-nao-oficial.md) | WhatsApp não-oficial (Evolution), com termo de aceite | aceita, com risco declarado |
| [ADR-008](ADR-008-pedido-do-catalogo-nao-se-perde.md) | O pedido do catálogo não pode se perder | aceita |
| [ADR-009](ADR-009-multi-tenant-por-companyId.md) | Isolamento entre lojas por `companyId` | aceita |
| [ADR-010](ADR-010-revisao-antes-do-push.md) | Revisão especialista obrigatória antes de todo push | aceita |
| [ADR-011](ADR-011-etiqueta-com-nfe.md) | Etiqueta com NF-e quando a nota existe | aceita |
| [ADR-012](ADR-012-navegador-nao-carrega-servidor.md) | O navegador não carrega código de servidor; build local = build da Vercel | aceita |
| [ADR-013](ADR-013-desconto-global.md) | Desconto é global: em %, incide sobre o total com acréscimo; pedido antigo não é reescrito de carona | aceita |
