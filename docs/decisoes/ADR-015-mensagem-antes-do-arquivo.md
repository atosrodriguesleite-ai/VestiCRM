# ADR-015 — A mensagem nasce antes do arquivo

- **Situação:** aceita
- **Regras ligadas:** RN-028 (a regra em si); RN-017 (a conexão não-oficial é
  quem entrega a mídia); ADR-002 (a repesca é carona no tráfego, nunca cron);
  ADR-003 (o arquivo mora como data-URL no banco — é a dívida que impõe o teto);
  ADR-008 (a mesma filosofia do pedido do catálogo, agora para a conversa)
- **Registrada em:** 31/08/2026 (auditoria do módulo de WhatsApp, pedida pelo
  dono antes de o módulo virar base de um produto novo)

## Contexto

O webhook do WhatsApp não recebe o arquivo: recebe o **aviso** de que existe
uma foto, um áudio ou um documento, e precisa buscá-lo no servidor de conexão.
O código fazia isso na ordem intuitiva — **baixa e depois grava**. Essa ordem
tinha dois buracos por onde mensagem de cliente sumia:

1. **O lote estourava o tempo da função.** O webhook tinha 30 segundos de vida
   (`maxDuration`) e cada download podia levar até 45 (o teto do cliente HTTP).
   A conta nunca fechou: a cliente mandando dez fotos de uma vez — ou um
   documento grande — fazia a Vercel matar a execução no meio. As mensagens do
   lote que ainda não tinham sido gravadas **sumiam sem deixar rastro**, e nem
   o registro de erro chegava a rodar, porque ele também morria junto.
2. **Falhou uma vez, perdeu para sempre.** Servidor ocupado, arquivo ainda em
   processamento, uma instabilidade de rede: o download voltava vazio, a bolha
   virava um texto seco com um aviso entre parênteses, e **ninguém tentava de
   novo**. Não havia fila, não havia registro no painel de Saúde, não havia
   como descobrir depois quantos arquivos tinham ficado pelo caminho.

O segundo buraco é o mesmo defeito que a RN-010 matou no pedido do catálogo
(`.catch(() => {})` engolindo a falha). O primeiro é pior, porque some com a
conversa inteira, não só com o anexo.

## Decisão

1. **A gravação nunca depende do download.** A mensagem entra primeiro, já
   marcada como "arquivo pendente" (`Message.mediaPending`); o arquivo é
   buscado em seguida e preenchido depois. A bolha existe desde o primeiro
   instante — a conversa nunca perde o registro de que a cliente falou.
2. **O download tem orçamento de tempo dentro do webhook.** Um teto por
   arquivo (12s) e um teto para o lote inteiro (25s), dentro de uma função que
   agora vive 60s. Estourou o orçamento, as mensagens seguintes continuam
   sendo **gravadas na hora** — só o arquivo delas vai para a fila.
3. **O que não chegou fica numa fila e é repescado**, com espera crescente
   (1min → 5min → 15min → 1h → 3h → 6h). A repesca pega **carona no tráfego**
   do app, com trava atômica de uma rodada por minuto — nunca um cron novo
   (ADR-002).
4. **Desistir é um ato explícito e registrado.** Esgotadas as tentativas, a
   mensagem sai da fila (senão a repesca bateria nela para sempre), a bolha
   passa a dizer que o arquivo não chegou, e o caso vai para o painel de Saúde
   e para a Central de Comunicação com o nome do arquivo. Silêncio aqui seria
   exatamente o defeito que esta decisão existe para matar.
5. **A tela diz em que pé está**: "Arquivo chegando…" enquanto a fila trabalha;
   "O arquivo não chegou — abra o WhatsApp para vê-lo" quando acabou. A
   vendedora nunca fica olhando uma bolha muda sem saber se espera ou age.

## Consequências

- Um lote de vinte fotos não perde nada: as vinte bolhas nascem, e os arquivos
  entram ao longo dos minutos seguintes.
- O arquivo pode aparecer **depois** da bolha — é a troca consciente: preferimos
  a conversa completa com o anexo atrasado à conversa incompleta.
- A repesca acorda o sync incremental (toca a conversa) — sem isso o arquivo
  chegaria ao banco e ficaria invisível na tela até alguém recarregar a página,
  o mesmo buraco que já mordeu a edição, a reação e o apagar.
- **O teto de tamanho continua existindo** (~12 MB) porque a mídia mora como
  data-URL no banco (ADR-003). Acima disso o sistema desiste **na hora** e
  avisa, em vez de insistir numa porta que não vai abrir. É o argumento mais
  forte para blob storage no produto novo: sem ele, a premissa "se a cliente
  mandou, tem que chegar" tem uma exceção declarada.
- Guarda: `midia-pendente.test.ts` — inclusive o teste que compara o teto do
  download com o tempo de vida da função, que é o incidente desta decisão.
