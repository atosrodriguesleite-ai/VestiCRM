# ADR-020 — O funil anda sozinho pela etapa LIGADA ao marco, nunca pelo nome; ganho e perdido são fixos

- **Situação:** aceita
- **Regras ligadas:** RN-091 (o editor do funil); RN-008 (o lead entra na
  primeira etapa); RN-001 (pedido pago fecha o cartão como ganho); ADR-001
  (migração escrita à mão)
- **Decidida em:** 21/10/2026

## Contexto

Uma cliente (Sutilli Semijoias) pediu para editar o funil: criar, renomear,
apagar etapas. O funil já existia por loja (`Pipeline`/`Stage`), mas o
sistema **achava as etapas automáticas pelo NOME**: a vendedora respondeu →
procura "Primeiro contato"; a cliente abriu o catálogo → "Catálogo
enviado"; virou orçamento → "Pedido em negociação"; aguardando pagamento →
"Pagamento pendente" (lista `NOMES` em `funil-auto.ts`, usada também em
`opportunity-sync.ts` e `automations.ts`). Liberar o renomear do jeito
simples faria o funil parar de andar **em silêncio** na primeira loja que
trocasse um nome — a classe de defeito "funciona até alguém mexer" que
ninguém relata, porque ninguém percebe.

## Decisão

1. **Marco aponta para etapa por ID, numa tabela própria**
   (`EtapaAutomatica`: funil × marco → etapa). Vários marcos podem apontar
   para a mesma etapa (a loja que juntou duas colunas numa só). Sem linha =
   "não mover" — é decisão da loja, nunca palpite. Nenhum código procura
   etapa pelo nome; um teste varre `src` e derruba o build se voltar.
2. **A migração preenche os vínculos pela MESMA régua do nome** (sem acento,
   sem caixa, a etapa aberta de menor ordem): no dia da troca nenhuma loja
   percebe diferença. Todo lugar que cria funil (provisionamento, plataforma,
   bootstrap, seeds) cria os vínculos junto; um teste confere.
3. **Ganho e perdido não se apagam** (renomeiam): é para lá que pedido pago e
   cancelado levam o cartão. **A primeira etapa é sempre aberta** (é a porta
   de entrada do lead). Marco só aponta para etapa aberta **antes do ganho**
   — o que também mantém o ganho no fim da parte de venda, que é onde
   reabrir pedido e o Dashboard o procuram.
4. **Apagar etapa exige destino aberto** e leva tudo junto: cartões, regra de
   "em qual etapa cada origem entra" e marcos. Cartão nunca some e nunca
   fecha sozinho.
5. **Chave por loja, ligada pelo Super Admin, sem custo**
   (`Company.funilEditavelEnabled`). Desligar só esconde o editor — o funil
   fica como a loja deixou. A chave controla o lançamento; se várias lojas
   usarem sem problema, a ideia é liberar para todas e a chave sair.

## Consequências

- O "só avança" continua pela ORDEM das etapas: reordenar muda o que conta
  como avançar. O editor diz isso ao lado das escolhas.
- Uma loja provisionada pelo código ANTIGO durante a janela do deploy
  nasceria sem vínculos. Ao abrir o Funil, o reparo de carona religa pela
  régua do nome — só em loja SEM o editor, onde "nenhum vínculo" não pode
  ter sido escolha. Limite que sobra: loja com o editor ligado e "não
  mover" nos quatro que depois tem a chave desligada é religada pelo nome.
- Vários funis por loja continuam fora: o código segue assumindo um (as
  consultas são por loja). O vínculo já é por funil, para não fechar a porta.
