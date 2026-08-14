# ADR-008 — O pedido do catálogo não pode se perder (protocolo + idempotência)

- **Situação:** aceita
- **Regras ligadas:** RN-009, RN-010, RN-012
- **Registrada em:** 14/08/2026 (decisão anterior, documentada agora)

## Contexto

O pedido do catálogo público nasce **no celular da cliente**, em rede móvel
instável, e é enviado ao servidor antes de abrir o WhatsApp da vendedora.

Incidente real: o envio tinha um `.catch(() => {})` que engolia a falha em
silêncio. A cliente via a mensagem do pedido chegar no WhatsApp da vendedora —
e o pedido **não existia no sistema**. A vendedora só descobria quando ia
procurar.

## Decisão

O envio é tratado como transação que **precisa** completar
(`lib/catalogo/envio-pedido.ts`):

1. O aparelho **sorteia um protocolo** (`Order.clientRef`), único por loja.
2. O pedido é **guardado antes** de abrir o WhatsApp.
3. Se falhar, o aparelho **insiste**; se a cliente sair, **reenvia na próxima
   visita** (o protocolo sobrevive no aparelho).
4. A rota é **idempotente**: mesmo protocolo devolve o pedido que já existe.
   A corrida de dois envios simultâneos cai no índice único do banco e o
   `P2002` é tratado como "já existe" — não como erro.
5. A cliente **vê o recibo** do registro na tela. Sem recibo, ela sabe que algo
   deu errado.
6. Nenhuma falha é silenciosa. `.catch(() => {})` nesse caminho é proibido.

**Preço sempre do servidor.** O total nunca vem do navegador: é recalculado do
cadastro da loja. Vale também para o resgate manual ("Colar pedido do
WhatsApp") — a mensagem só diz **o que** a cliente pediu, o **quanto custa**
sai do nosso cadastro.

## Consequências

- ✅ Pedido enviado é pedido registrado. O protocolo é a prova.
- ✅ Duplicidade é impossível pelo índice único, não por confiança na tela.
- ⚠️ Todo caminho novo que crie pedido do catálogo precisa passar pelo mesmo
  fluxo — atalho aqui reabre o buraco.

## Resgate manual

Para a venda que só existe na conversa: **"Colar pedido do WhatsApp"** na tela
Pedidos (`lib/catalogo/ler-mensagem.ts`). Lê a mensagem, casa com o catálogo da
loja (nome mais longo vence ao separar produto e cor), mostra prévia **sem
gravar nada** e cria pelo caminho normal (`POST /api/orders`). Linha sem
cadastro ou sem estoque fica de fora e é anotada no pedido — nunca é inventada.
