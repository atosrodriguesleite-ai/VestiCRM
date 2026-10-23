# ADR-022 — A tela branca de abertura se resolve nos primeiros bytes da página, nunca com cache de página

- **Situação:** aceita
- **Regras ligadas:** RN-095 (a regra em si); RN-066 (a tela que quebrou se
  recupera — e o que ela NÃO alcança); RN-070 (a logo pesada que travava a
  vitrine); RN-010 (o que não se perde fica guardado no aparelho)
- **Decidida em:** 23/10/2026

## Contexto

Relato do dono: *"outra cliente foi tentar acessar o aplicativo pelo celular
em uma conexão diferente, pela Starlink do carro, e não está abrindo. Ela
entra no aplicativo e a tela fica toda branca… já é o segundo cliente que
reclama"*.

A RN-066 já tinha dado ao app uma tela de socorro para a tela que QUEBRA.
Mas ela é JavaScript, e a bancada (`scripts/bancada-tela-branca.mjs`, o
Chromium abrindo o build de produção local com prints) mostrou que o branco
desta vez vem de ANTES do JavaScript:

- em todo cenário em que a página **chega** — sem JavaScript, sem CSS, sem
  nenhum pedaço de código — há algo na tela (menu, esqueleto, texto cru);
- o branco total aparece quando a página **não chega** (sem rede ao abrir:
  o Chromium mostra a página dele; o app instalado do iPhone mostra branco,
  sem botão) ou **chega cortada**: no celular, o primeiro pedaço visível (o
  esqueleto de carregamento) só vem por volta de 25% do arquivo — antes dele
  é o menu lateral, escondido no celular. A conexão que cai entre 3% e 25%
  deixa o fundo e nada mais, para sempre, sem erro nenhum.

Numa Starlink em movimento (troca de satélite, túnel, sinal que oscila), a
conexão que cai no meio de um download de 100 KB não é exceção.

## Decisão

1. **O remédio viaja nos PRIMEIROS bytes e não depende de nada.** Um
   script miúdo, escrito à mão em JavaScript antigo, é o primeiro filho do
   `<body>` do layout raiz (`lib/vigia-da-abertura.ts`) — chega junto com o
   `<head>`, antes de qualquer tela, em qualquer navegador. Ele observa um
   **marcador** que o mesmo layout põe como último filho do `<body>`: se o
   marcador existe, o esqueleto da página chegou inteiro. Tudo o que o vigia
   usa está dentro dele: nenhum import, nenhum CSS, nenhum pedaço de código
   que possa não ter chegado.

2. **Só fala com certeza, mede "parou" pelo progresso, e nunca recarrega
   sozinho com internet.** Página lenta não é página quebrada: enquanto nós
   novos continuam chegando ao documento, ele fica quieto — um aviso num
   link de 15 kbps faria a pessoa recomeçar do zero um download que ia
   terminar. Fala quando a página terminou sem o marcador e sem nada
   visível (a cortada), quando o download PAROU por 12 s sem nada visível ou
   por 40 s com algo na tela, quando a tela ficou presa no esqueleto por
   40 s depois de ele aparecer, ou aos 60 s sem a página inteira. "Visível"
   é texto, imagem, botão ou caixa pintada — contêiner vazio com altura é a
   própria tela branca. O aviso é em português, com botão — a régua da
   RN-066: recarregar às escondidas esconderia o defeito; sem internet, ele
   espera o `online` e recarrega uma vez (o caso do app instalado, que
   offline não tem botão nenhum). **Depois que a página chegou inteira, ele
   se cala para sempre**: a navegação seguinte (mesmo esqueleto) e a tela
   de socorro da RN-066 (que troca o corpo e leva o marcador) não são
   assunto dele.

3. **O service worker entra só quando a REDE falha — e nunca guarda nada.**
   A página que não chegou nada é invisível para o vigia (ele também não
   chegou). Para esse caso, o service worker passa a ser registrado em todo
   aparelho logado (antes só quem ligava as notificações de venda o tinha) e
   ganha uma tarefa: quando a navegação não alcança o servidor (a promessa
   do `fetch` rejeita), responde a página "Sem conexão" **escrita no próprio
   arquivo**, em HTML puro, com o botão e a volta automática no `online`.
   **Rede primeiro, sempre.** Resposta do servidor — 200, 404, 500 — passa
   como veio. Foram recusadas DUAS alternativas: "guardar a última página boa
   e servir do cache" (é o que faz app instalado mostrar versão velha, o
   defeito que a RN-066 já gasta meia regra para contornar) e "guardar uma
   página `/offline` do app no cache" — foi a primeira versão, e a revisão
   mostrou o buraco: a página guardada precisa do código do React para o
   botão funcionar, e offline esse código não vem; o botão estaria morto
   justamente na situação para a qual a página existe. Só navegação, só a
   própria origem; API, fotos e código seguem direto; e a navegação sai em
   paralelo com a partida do worker (`navigationPreload`) — sem isso cada
   abertura de página esperaria o worker acordar.

4. **Fica contado, pelo caminho que já existe.** O vigia guarda o relato no
   aparelho com o MESMO formato e a MESMA chave da RN-066, e quem o manda é o
   mesmo componente, no próximo carregamento que der certo, com login. A
   fonte é própria (`tela.abertura`): é a conexão da pessoa, não o código —
   fica fora da conta de erros e em bloco próprio na Saúde, para se SABER
   quantas aberturas falham, em que loja e em que navegador. Sem isso a
   próxima reclamação seria outro chute.

## Consequências

- Toda página do app e do catálogo ganha ~3 KB de script no começo do
  `<body>` e um `<span hidden>` no fim. É o preço de o remédio chegar antes
  do problema.
- O layout raiz tem uma estrutura que o teste GUARDA (primeiro filho =
  script, último = marcador). Mover qualquer um dos dois desliga o vigia em
  silêncio.
- O esqueleto de carregamento do app (`app/(app)/loading.tsx`) é parte da
  regra: o vigia o reconhece por `aria-busy="true"` + `aria-label="Carregando"`.
  Trocar esses atributos sem trocar o seletor cega o caso "presa no
  carregando" (o teste confere).
- O service worker vira código em produção em todo aparelho logado. Mudar o
  arquivo `public/sw.js` muda o comportamento de abertura de todo mundo. A
  página "Sem conexão" existe em dois lugares de propósito (no vigia e no
  service worker) — são dois momentos diferentes, e nenhum dos dois pode
  depender de um arquivo externo.
- O que NÃO se resolve aqui, e está dito: a causa de rede da cliente
  (Starlink em movimento, bloqueio por navegador ou por firewall). O que se
  resolve é a tela muda — agora ela diz o que houve, tem botão, e conta.
