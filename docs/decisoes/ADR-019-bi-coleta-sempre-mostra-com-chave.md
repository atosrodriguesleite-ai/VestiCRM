# ADR-019 — BI de vendas do WhatsApp: coleta sempre, mostra com a chave, números prontos de carona

- **Situação:** aceita
- **Regras ligadas:** RN-079 (horário de atendimento), RN-080 (mensagem
  de robô e a espera pareada) e RN-081 (motivo de perda em lista fechada) —
  as três peças da Fase 0, concluída em 13/10/2026; RN-082 (fatos diários,
  painel e chave — a Fase 1, 14/10/2026); RN-083 (os mesmos fatos por
  vendedora — a Fase 2a, 14/10/2026); RN-084 (a carteira da Recompra em
  R × F × M — a Fase 2b, 14/10/2026); RN-085 (ROI de anúncio com gasto por
  mês — a Fase 2c, 14/10/2026); RN-086 (clicar e cavar — a primeira peça
  da Fase 3, 14/10/2026); RN-087 (a linha de 12 meses, 14/10/2026); RN-088 (a faixa "hoje" ao
  vivo, 14/10/2026);
  RN-001/RN-002 (venda é pedido pago, por `netTotal`); RN-005/RN-007
  (comissão e visibilidade por vendedora); RN-008 (origem do lead no portão
  único); RN-063 (selo calculado dos pedidos, nunca colocado à mão — o
  mesmo princípio para todo indicador); ADR-002 (nunca um 3º cron)
- **Decidida em:** 13/10/2026

## Contexto

O dono quer um BI completo de gestão de vendas pelo WhatsApp — leads por
dia e por anúncio, funil, conversão, recompra, melhores clientes, ticket
médio, evolução, metas, tempo de resposta dentro do horário da loja — como
módulo com chave liga/desliga, vendido junto da assessoria de organização
do processo comercial. Nas palavras dele, "a cereja do bolo, onde se
unificam as principais informações do sistema".

Três fatos do código pesaram na decisão:

1. **Metade do que se quer medir ainda não era gravado** (situação em
   13/10/2026, antes da Fase 0). Não havia horário de atendimento em lugar
   nenhum (→ RN-079); o tempo de resposta existia só no monitor da IA de
   Vendas (`lib/ia.ts`), pelo relógio de parede, e a mensagem de robô não
   se distinguia da humana (→ RN-080); a origem do lead só diz o canal (e
   qual anúncio, só quando ele chega por link rastreado — fica assim, por
   decisão do dono); o motivo de perda da oportunidade era texto livre na
   porta (→ RN-081).
2. **A tabela de mensagens é a maior do banco** (120 mil linhas numa loja
   de 2 mil conversas) e o Postgres fica em outra região. Calcular tempo de
   resposta varrendo-a a cada abertura do painel estouraria o tempo da
   função — o mesmo buraco que a sincronização da Nuvemshop caiu (etapas de
   25 s, RN-014).
3. **Etapa de funil arrastada à mão mente** (a lição da RN-063): a
   vendedora esquece, erra e a etiqueta envelhece. Um BI que some etapas
   mostra o processo que a loja diz seguir, não o que ela segue.

## Decisão

1. **A instrumentação vale para TODAS as lojas, desde o dia 1; a chave só
   abre a TELA.** Se a coleta dependesse da chave, a loja que fechasse a
   assessoria começaria com zero histórico — e o primeiro mês do BI seria
   um painel vazio. Horário, marcas e carimbos são gravados sempre; o
   módulo (`biEnabled`, a chave do catálogo de módulos) decide só quem vê.
2. **Instrumentar antes de mostrar.** A Fase 0 não tem tela de BI: cadastra
   horário (RN-079), marca mensagem automática, fecha a lista de motivos de
   perda. A tela "cinematográfica" vem na Fase 1, sobre dados que já estão
   sendo contados certos. Tela bonita sobre número errado é o pior dos dois
   mundos: ganha confiança e mente.
3. **Os números do painel vêm PRONTOS de fatos diários** (loja × dia e
   loja × vendedora × dia), preenchidos **de carona no tráfego** com trava
   por loja — o desenho das repescas (RN-028, RN-053), nunca um 3º cron
   (ADR-002). O painel lê linhas somadas; a varredura pesada roda uma vez
   por dia, sobre as mensagens DAQUELE dia.
4. **Todo indicador deriva de FATO, nunca de estado digitado**: lead =
   cliente criada pelo portão único; respondido = primeira mensagem de uma
   PESSOA da loja depois da primeira mensagem da cliente (mensagem de robô
   não conta — recuperação automática, campanhas); pedido = `Order`; venda
   = pedido pago (RN-001); recompra = segundo pedido pago. As etapas do
   funil da tela continuam existindo para a equipe trabalhar — o BI não as
   soma.
5. **Todo número abre a lista** (quais conversas, quais pedidos) e vem com
   a comparação do período anterior — número sem lista não ganha confiança
   (a lição da RN-042). Animação é bem-vinda; esconder a lista atrás dela,
   não.
6. **Só gerência vê** (decisão do dono); a vendedora continua com o monitor
   que já tem. O prazo de resposta é um só, `intakeSlaMinutes`, em minutos
   de atendimento.

## Consequências

- Ganha: o dia em que uma loja contrata o BI, ele já tem meses de história
  certa; o painel abre em milissegundos mesmo na loja de 120 mil mensagens;
  o tempo de resposta é justo com quem fecha às 18h.
- Custa: um lote de colunas e marcas em toda loja (pequeno: horário, uma
  marca booleana por mensagem, chips de motivo); e disciplina — toda porta
  nova que envia mensagem por robô tem que marcar a mensagem como
  automática, senão o robô vira "resposta humana em 0 min".
- Limite dito: o histórico anterior à marca de mensagem automática conta as
  mensagens da recuperação automática como resposta humana; e a origem por
  anúncio só existe para o lead que chegou por link rastreado — o bolo
  "não identificado" é o primeiro achado da assessoria, não um defeito.
