# ADR-023 — O WhatsApp de onde a mensagem do pedido chegou é o número verificado, e só com prova forte o sistema junta cadastro sozinho

- **Situação:** aceita
- **Data:** 26/10/2026
- **Regras ligadas:** RN-096 e RN-097 (as regras em si); RN-021 (o link
  pessoal, que esta decisão estende); RN-020 (cadastro parecido nunca se
  junta sozinho — a exceção dita aqui); RN-043 (a bolha única do pedido);
  RN-010 (o pedido do catálogo não pode se perder)

## Contexto

Relato do dono com dois prints da Toque Leve: a cliente Rafaela preencheu o
pedido do catálogo com o telefone (19) 98839-4961 e apertou "enviar" no
WhatsApp do aparelho dela, que é **+1 781 408-6755** (EUA). Nasceram dois
cadastros, duas conversas (uma "na fila", que ninguém conseguia responder) e
a bolha do pedido apareceu nas duas — e o número de fora aparecia como
"(17) 81408-6755", um DDD de verdade com um celular que não existe.

Duas regras da casa deixavam esse caso passar:

- a bolha única do pedido (RN-043) só junta a **mesma** cliente, e a
  sobreposição do WhatsApp sobre o digitado (RN-021) só vale quando a cliente
  entrou pelo **link pessoal** e o digitado está a um dígito de distância;
- a RN-020 diz, de propósito, que cadastro parecido **nunca** se junta
  sozinho: juntar gente errada é pior que o duplicado. O aviso "o mesmo pedido
  chegou dos dois números" já existia na Central, com o botão de unificar para
  a gerência — e o dono pediu que não duplicasse.

## Decisão

1. **O número do WhatsApp já vem com o DDI e nunca ganha 55** (RN-096). O
   identificador de lá é internacional por definição; quem o passa adiante
   escreve o `+` na frente e nada mais é adivinhado. O número digitado só ganha
   55 quando tem cara de brasileiro (DDD que existe, o 9 na terceira posição
   com onze dígitos). Número de fora é mostrado como tal ("+1 781 408-6755").

2. **O WhatsApp por onde a mensagem do pedido chegou é o número verificado**
   (RN-097): foi o aparelho que montou o pedido que a mandou. Ele vence o
   digitado por mais diferente que seja — e vence até o link pessoal —, com a
   diferença anotada na conversa, na linha do tempo e no pedido.

3. **Juntar cadastro sozinho só com prova forte, as três ao mesmo tempo**: o
   texto é o do pedido, idêntico, dentro da meia hora da bolha; o cadastro do
   telefone digitado **nasceu deste pedido** (origem catálogo, criado na
   janela, nunca recebeu mensagem pelo WhatsApp); e, para fundir, o pedido já
   existe. Fora disso — o número digitado é de uma cliente de verdade da loja —
   nada é tocado e vale o aviso de sempre, com a gerência decidindo. É a única
   exceção à RN-020, e ela é dita.

4. **Nada se apaga enquanto o pedido está nascendo.** A porta do catálogo
   cria o pedido depois do intake; o webhook que vê a bolha sem o pedido não
   funde (o cadastro sumiria debaixo da criação do pedido, RN-010). A corrida
   é fechada pela própria porta do pedido, no fim, com o pedido criado. Os
   dois lados tomam a mesma trava, pelo texto limpo do pedido.

## Consequências

- A cliente de fora recebe resposta: o cadastro passa a ter o número que o
  WhatsApp manda, e o antigo com o 55 colado se cura sozinho (primeira
  mensagem) ou pela migração (onde não há colisão).
- Um pedido com telefone digitado diferente do WhatsApp vira **um** cadastro,
  **uma** conversa e **uma** bolha — sem a gerência precisar unificar.
- Limites aceitos e ditos: número de fora digitado **sem** o `+` com a cara
  exata de um celular brasileiro segue lido como brasileiro (vindo do WhatsApp
  nunca há dúvida); e quando o digitado é de uma cliente de verdade, o
  duplicado continua, com o aviso, porque para o sistema são duas pessoas.
- Toda porta nova que crie cliente a partir de um número do WhatsApp tem que
  passá-lo com o `+` — é o que impede o 55 de carona.
