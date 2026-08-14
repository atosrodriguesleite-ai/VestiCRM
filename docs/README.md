# Documentação do AtacadoPro

**A régua desta pasta:** um documento só existe se **alguma coisa quebra sem
ele**. Se o código responde a pergunta sozinho, não vira documento — vira
comentário no código ou teste.

O motivo é prático: documento desatualizado é **pior** que documento nenhum,
porque quem lê (pessoa ou IA) confia nele e implementa errado com convicção.
Por isso a pasta é pequena de propósito, e o que dá para guardar com teste é
guardado com teste.

## Onde está cada coisa

| Pergunta | Onde responder |
|---|---|
| Qual a regra de negócio? | **`CLAUDE.md`** (raiz) — com o motivo e o incidente que a criou |
| Que número tem essa regra? | [`regras.md`](regras.md) — índice RN-0XX |
| Por que foi feito assim? | [`decisoes/`](decisoes/README.md) — ADRs |
| Como sabemos que funciona? | os testes (`npm test`) |
| Como são os dados? | `prisma/schema.prisma`, comentado em português |
| Quais contas externas existem? | [`integracoes.md`](integracoes.md) |
| Deu problema em produção? | [`runbook.md`](runbook.md) |
| E a parte jurídica? | [`juridico/`](juridico/situacao-atual.md) |
| Que formato tem o arquivo de importação de catálogo? | [`IMPORTAR-CATALOGO.md`](IMPORTAR-CATALOGO.md) |

## Já foi aposentado daqui

- `ESTADO-DO-PROJETO.md` — mandava "leia ao iniciar a sessão" e falava em
  **52 testes**, com o WhatsApp "adiado" e a Toque Leve como "próximo passo".
  Tudo isso já era falso. O que valia (DNS, bootstrap, variáveis) foi para
  `integracoes.md`.
- `PRODUCAO.md` — ensinava `prisma migrate dev`, que é **proibido** neste
  projeto (ADR-001). O que valia foi para `integracoes.md` e `runbook.md`.

Os dois estão no histórico do Git. O teste `docs-regras.test.ts` impede que
voltem.

## O que NÃO vira documento aqui

- **Lista de rotas da API** — são ~130 e envelhecem em uma semana. O código é
  a lista.
- **Descrição do modelo de dados** — o `schema.prisma` já está comentado, e ele
  não pode mentir.
- **Estratégia de testes** — a suíte é grande e vários testes *são* a regra
  escrita de forma executável. Contagem não entra em documento: envelhece a
  cada entrega.
- **Instruções para agentes de IA** — isso é o `CLAUDE.md`, que já é lido
  automaticamente. Um segundo arquivo dizendo o mesmo criaria duas versões que
  um dia discordam.

## Como isso é usado no trabalho

O protocolo está no `CLAUDE.md`, seção *"Como usar a documentação"*. Em
resumo: antes de implementar, localizar as RN e os ADR envolvidos; ao terminar,
atualizar o que a mudança afetou e dizer quais IDs foram tocados.
