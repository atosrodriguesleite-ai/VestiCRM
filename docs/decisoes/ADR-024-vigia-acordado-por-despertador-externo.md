# ADR-024 — O vigia do WhatsApp é acordado também por um despertador externo, e cura antes de alarmar

- **Situação:** aceita
- **Data:** 03/11/2026
- **Regras ligadas:** RN-106 (a regra em si); RN-105 (o vigia, o reinício e
  a sonda que esta decisão reaproveita); ADR-002 (no máximo 2 crons, ambos
  diários — que esta decisão NÃO muda)

## Contexto

O incidente de 02/11/2026: lojas "conectadas", envios saindo e nenhuma
mensagem de cliente entrando. O alarme de loja muda (RN-105) só tocava depois
de um dia inteiro de atendimento, e o vigia só roda de carona no tráfego —
de madrugada ou num domingo sem ninguém usando, ninguém vigia nada. O dono
pediu: saber se o WhatsApp está FUNCIONANDO, ser avisado quando parar, e que
a situação seja evitada.

## Decisão

1. **O teste do eco é a prova de funcionamento.** Todo envio pelo sistema
   volta pelo webhook em segundos (o eco do WhatsApp). Envio sem eco há 12
   minutos é o caminho das mensagens quebrado — sem mandar nada a mais ao
   WhatsApp. Uma sonda periódica da sessão (mandar sinal ao WhatsApp a cada
   15 min) foi oferecida e **recusada pelo dono** (risco de bloqueio que
   ninguém sabe medir).
2. **Cura antes de alarme, uma vez, no fim da rodada do vigia.** O sistema
   reinicia a conexão sozinho pela MESMA porta do botão (RN-105), no
   máximo uma vez a cada 6 h por loja, uma por rodada, DEPOIS de todos os
   alarmes da rodada. A queda de rede avisada pelo webhook espera 1 min
   (o próprio WhatsApp costuma religar; reiniciar por cima atrapalharia) e
   então cura ali mesmo, depois da resposta — sem depender de tráfego nem do
   despertador; o vigia é a segunda tranca (a desconectada há 3 min). A que
   só volta com QR alarma na hora. O reinício não apaga a prova do eco calado — o próximo
   envio confirma. Voltou: só a plataforma fica sabendo. Não voltou: o
   alarme de sempre, e uma rede de segurança garante que nenhuma queda fica
   mais de ~10 min sem alarme. Reiniciar em laço esconderia o problema.
   A primeira versão curava direto no webhook a cada "close": a revisão
   mostrou corridas (duas quedas seguidas disputando a cura, alarme falso
   para o perdedor), cura gastando a vez em queda que voltaria sozinha, e
   sessão presa em "reconectando" sem alarme nunca.
3. **Um despertador EXTERNO pode acordar o vigia** (`GET /api/vigia`, a cada
   5 min, por um serviço gratuito como o cron-job.org). Não é um cron da
   Vercel — o limite do ADR-002 continua intacto e o guarda do build segue
   valendo. O endereço é **público e sem segredo**, de propósito: ele só
   acorda o vigia, que tem trava atômica própria (uma rodada a cada 5 min,
   não importa quantas chamadas cheguem), não recebe nada e não devolve nada
   sobre as lojas. Sem segredo, o dono configura sem mexer nas variáveis da
   Vercel (a lição da `CRED_SECRET`, que ainda espera).

## Consequências

- O sistema funciona igual SEM o despertador (de carona, como antes); com
  ele, a vigilância vale de madrugada e no fim de semana.
- O endereço sempre responde 200: o despertador externo desliga a tarefa
  depois de muitas falhas seguidas, e uma loja desconectada por dias não
  pode matar a vigilância das outras.
- Trabalho periódico novo continua NÃO virando cron (ADR-002): se precisar
  de batida fora do tráfego, entra na rodada do vigia, com trava.
