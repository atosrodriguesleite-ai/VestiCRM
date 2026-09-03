/**
 * OS EMOJIS DO COMPOSITOR DA CENTRAL — e como PESQUISAR um deles.
 *
 * Pedido do dono (03/09/2026): "quando vou enviar um emoji tenho que ficar
 * procurando, tem como colocar uma barra de pesquisa?". Cada emoji leva as
 * palavras pelas quais a vendedora o procura, em português do dia a dia
 * ("coração", "feliz", "dinheiro", "caixa"), e a busca ignora acento e
 * maiúscula — ninguém digita "coração" com cedilha no corre.
 *
 * A grade continua organizada para venda de moda (roupas, dinheiro, festa
 * primeiro); a pesquisa é só um atalho por cima dela.
 */
type Grupo = { titulo: string; itens: [emoji: string, palavras: string][] };

const GRUPOS: Grupo[] = [
  {
    titulo: "Corações",
    itens: [
      ["🤎", "coração marrom"], ["❤️", "coração vermelho amor"], ["🧡", "coração laranja"],
      ["💛", "coração amarelo"], ["💚", "coração verde"], ["💙", "coração azul"],
      ["💜", "coração roxo lilás"], ["🖤", "coração preto"], ["🤍", "coração branco"],
      ["🩷", "coração rosa"], ["🩵", "coração azul claro"], ["🩶", "coração cinza"],
      ["💖", "coração brilhante amor"], ["💕", "dois corações amor"], ["💞", "corações girando amor"],
      ["💓", "coração batendo amor"], ["💗", "coração crescendo amor"], ["💘", "coração flecha amor"],
      ["💝", "coração presente laço"], ["💟", "coração decoração"], ["❣️", "coração exclamação"],
      ["❤️‍🔥", "coração fogo paixão"], ["❤️‍🩹", "coração curativo"], ["💔", "coração partido triste"],
      ["💌", "carta de amor"], ["💋", "beijo boca batom"],
    ],
  },
  {
    titulo: "Carinhas",
    itens: [
      ["😀", "feliz sorriso alegre"], ["😃", "feliz sorriso alegre"], ["😄", "feliz sorriso alegre rindo"],
      ["😁", "sorriso dentes feliz"], ["😆", "rindo risada feliz"], ["😅", "rindo suor alívio"],
      ["😂", "chorando de rir risada kkk"], ["🤣", "rolando de rir risada kkk"], ["🥲", "sorriso lágrima emocionado"],
      ["🥹", "emocionado lágrima gratidão"], ["😊", "feliz sorriso tímido fofo"], ["☺️", "sorriso tímido fofo"],
      ["🙂", "sorriso leve ok"], ["🙃", "de cabeça para baixo brincadeira"], ["😉", "piscada piscando"],
      ["😌", "aliviado calmo"], ["😍", "apaixonado olhos de coração amei"], ["🥰", "apaixonado corações amor fofo"],
      ["😘", "beijo mandando beijo"], ["😗", "beijo"], ["😙", "beijo sorrindo"], ["😚", "beijo olhos fechados"],
      ["😋", "delícia gostoso língua"], ["😛", "língua brincadeira"], ["😜", "língua piscada maluco"],
      ["🤪", "maluco doido louco"], ["😝", "língua olhos fechados"], ["🤩", "estrelas nos olhos uau incrível"],
      ["🥳", "festa aniversário comemorando"], ["😎", "óculos escuros legal estiloso"], ["🤓", "nerd óculos"],
      ["🧐", "monóculo analisando"], ["🤗", "abraço abraçando"], ["🤭", "mão na boca risinho"],
      ["🫢", "mão na boca surpresa"], ["🤫", "silêncio shh segredo"], ["🤔", "pensando dúvida hmm"],
      ["🫡", "continência sim senhora"], ["😐", "sem expressão neutro"], ["😑", "sem expressão"],
      ["😶", "sem boca calado"], ["🙄", "revirando os olhos"], ["😏", "sorriso de canto malicioso"],
      ["😬", "constrangido dentes eita"], ["😮‍💨", "suspiro alívio cansado"], ["😪", "sono cansado"],
      ["😴", "dormindo sono zzz"], ["🥱", "bocejo sono"], ["😷", "máscara doente"], ["🤒", "termômetro doente febre"],
      ["🤕", "machucado curativo"], ["🥴", "tonto zonzo"], ["😵", "tonto desmaiado"], ["🤯", "cabeça explodindo uau"],
      ["🥺", "pidão olhinhos por favor"], ["😢", "chorando triste lágrima"], ["😭", "chorando muito triste"],
      ["😤", "bufando bravo"], ["😠", "bravo raiva"], ["😱", "gritando medo susto"], ["😨", "medo assustado"],
      ["😰", "ansioso suor medo"], ["😥", "aliviado triste"], ["😓", "suor cansado"], ["🤤", "babando delícia"],
      ["😇", "anjo auréola santo"], ["🥸", "disfarce bigode"], ["🤠", "caubói chapéu"], ["😈", "diabinho travesso"],
      ["👻", "fantasma"], ["💀", "caveira morri kkk"], ["🤖", "robô"], ["👽", "alienígena et"],
      ["😺", "gato feliz"], ["😻", "gato apaixonado"], ["🙈", "macaco não vejo vergonha"],
      ["🙉", "macaco não ouço"], ["🙊", "macaco não falo"],
    ],
  },
  {
    titulo: "Gestos e pessoas",
    itens: [
      ["👍", "joinha positivo ok curtir"], ["👎", "negativo não curti"], ["👏", "palmas aplausos parabéns"],
      ["🙌", "mãos para cima comemorando aleluia"], ["🙏", "obrigada por favor oração amém"],
      ["🤝", "aperto de mão acordo negócio fechado"], ["💪", "força braço forte"], ["✌️", "paz e amor vitória dois"],
      ["🤞", "dedos cruzados torcendo sorte"], ["🫶", "coração com as mãos amor"], ["🤟", "amo você rock"],
      ["🤘", "rock chifrinho"], ["🤙", "me liga hang loose"], ["👌", "ok perfeito"], ["🤌", "mão italiana pinça"],
      ["🤏", "pouquinho pequeno"], ["👋", "tchau oi acenando olá"], ["🖐️", "mão aberta cinco"], ["✋", "pare mão"],
      ["🖖", "vulcano"], ["👈", "apontando esquerda"], ["👉", "apontando direita"], ["👆", "apontando cima"],
      ["👇", "apontando baixo aqui embaixo"], ["☝️", "dedo cima atenção um"], ["✊", "punho força"],
      ["👊", "soco punho"], ["🤛", "punho esquerda"], ["🤜", "punho direita"], ["🫵", "apontando você"],
      ["🤲", "mãos abertas pedindo"], ["🫰", "coração dedos"], ["✍️", "escrevendo assinatura"],
      ["💅", "unha esmalte manicure"], ["🤳", "selfie foto"], ["💃", "dançarina dança festa mulher"],
      ["🕺", "dançarino dança festa homem"], ["🧍‍♀️", "mulher em pé"], ["🏃‍♀️", "correndo corrida rápido"],
      ["👩", "mulher moça"], ["👨", "homem"], ["👧", "menina criança"], ["👦", "menino criança"],
      ["👶", "bebê nenê"], ["👵", "vovó idosa"], ["👴", "vovô idoso"], ["👩‍💼", "mulher de negócios escritório"],
      ["🤦‍♀️", "mão na testa vergonha"], ["🤷‍♀️", "não sei dando de ombros"], ["💁‍♀️", "atendente informação"],
      ["🙋‍♀️", "mão levantada eu presente"], ["🙆‍♀️", "ok braços certo"], ["🙅‍♀️", "não braços cruzados proibido"],
    ],
  },
  {
    titulo: "Festa e brilho",
    itens: [
      ["🎉", "festa confete comemoração parabéns"], ["🎊", "confete festa"], ["✨", "brilho brilhante novo"],
      ["⭐", "estrela"], ["🌟", "estrela brilhante"], ["💫", "estrela cadente tontura"], ["🔥", "fogo quente top arrasou"],
      ["💥", "explosão bum"], ["⚡", "raio rápido energia"], ["🏆", "troféu campeã vencedora"],
      ["🥇", "medalha de ouro primeiro lugar"], ["🥈", "medalha de prata segundo"], ["🥉", "medalha de bronze terceiro"],
      ["🎁", "presente caixa de presente"], ["🎈", "balão festa aniversário"], ["🎂", "bolo aniversário parabéns"],
      ["🍾", "champanhe garrafa comemorar"], ["🥂", "brinde taças comemorar"], ["🎶", "música notas"],
      ["🎵", "música nota"], ["👑", "coroa rainha"], ["💎", "diamante joia luxo"], ["🪩", "globo espelhado balada"],
      ["🎀", "laço fita rosa"], ["🧸", "ursinho pelúcia"], ["🎯", "alvo objetivo meta"], ["🧿", "olho grego proteção"],
      ["🍀", "trevo sorte"],
    ],
  },
  {
    titulo: "Moda e loja",
    itens: [
      ["👗", "vestido roupa"], ["👚", "blusa camisa feminina roupa"], ["👖", "calça jeans"], ["👕", "camiseta camisa roupa"],
      ["👔", "gravata camisa social"], ["👙", "biquíni praia moda praia"], ["🩱", "maiô praia"], ["🩳", "shorts bermuda"],
      ["👘", "quimono"], ["🥻", "sári"], ["🧥", "casaco jaqueta frio"], ["🦺", "colete"], ["👒", "chapéu"],
      ["🧢", "boné"], ["👜", "bolsa"], ["👛", "carteira bolsinha"], ["🎒", "mochila"], ["👠", "salto sapato scarpin"],
      ["👡", "sandália"], ["👢", "bota"], ["🥿", "sapatilha"], ["👞", "sapato masculino"], ["👟", "tênis"],
      ["🥾", "bota coturno"], ["🧦", "meia"], ["🧤", "luva"], ["🧣", "cachecol frio"], ["👓", "óculos"],
      ["🕶️", "óculos de sol"], ["💍", "anel aliança"], ["💄", "batom maquiagem"], ["⌚", "relógio"],
      ["💼", "maleta pasta trabalho"], ["🛍️", "sacola compras"], ["🛒", "carrinho compras"], ["🧵", "linha costura"],
      ["🪡", "agulha costura"], ["✂️", "tesoura corte"], ["🧶", "novelo lã tricô"], ["📦", "caixa pacote encomenda pedido"],
      ["🚚", "caminhão entrega frete"], ["✈️", "avião viagem envio"], ["🏭", "fábrica confecção"],
      ["🏬", "loja shopping"], ["🏠", "casa"],
    ],
  },
  {
    titulo: "Dinheiro",
    itens: [
      ["💰", "dinheiro saco de dinheiro"], ["💵", "dinheiro nota dólar"], ["💴", "dinheiro nota iene"],
      ["💶", "dinheiro nota euro"], ["💳", "cartão de crédito pagamento"], ["🪙", "moeda"], ["🤑", "rico dinheiro na boca"],
      ["🏷️", "etiqueta preço promoção"], ["💸", "dinheiro voando gasto"], ["🧾", "recibo nota comprovante"],
      ["📈", "gráfico subindo crescimento"], ["📊", "gráfico barras"], ["💲", "cifrão preço"], ["🏦", "banco"],
      ["🔖", "marcador etiqueta"],
    ],
  },
  {
    titulo: "Comida e bebida",
    itens: [
      ["☕", "café xícara"], ["🍵", "chá"], ["🥤", "refrigerante copo canudo"], ["🧉", "chimarrão mate"],
      ["🍷", "vinho taça"], ["🍹", "drink coquetel"], ["🍺", "cerveja"], ["🍫", "chocolate"], ["🍰", "bolo fatia doce"],
      ["🧁", "cupcake doce"], ["🍩", "rosquinha donut"], ["🍪", "biscoito cookie"], ["🍓", "morango fruta"],
      ["🍒", "cereja fruta"], ["🍉", "melancia fruta"], ["🍇", "uva fruta"], ["🥐", "croissant pão"], ["🍞", "pão"],
      ["🍕", "pizza"], ["🍔", "hambúrguer lanche"], ["🌭", "cachorro quente"], ["🍟", "batata frita"],
      ["🥗", "salada"], ["🍝", "macarrão massa"], ["🍦", "sorvete"], ["🍯", "mel"],
    ],
  },
  {
    titulo: "Natureza",
    itens: [
      ["☀️", "sol ensolarado calor"], ["🌤️", "sol com nuvem"], ["⛅", "nublado sol nuvem"], ["🌧️", "chuva"],
      ["⛈️", "tempestade raio chuva"], ["🌈", "arco-íris"], ["❄️", "neve frio floco"], ["🌙", "lua noite"],
      ["🌛", "lua sorrindo"], ["🌊", "onda mar praia"], ["💧", "gota água"], ["🌸", "flor de cerejeira rosa"],
      ["🌹", "rosa flor"], ["🌺", "hibisco flor"], ["🌻", "girassol flor"], ["🌷", "tulipa flor"],
      ["🌼", "margarida flor"], ["💐", "buquê flores"], ["🍃", "folha vento"], ["🌿", "erva folha"],
      ["☘️", "trevo"], ["🌴", "palmeira coqueiro praia"], ["🌵", "cacto"], ["🦋", "borboleta"], ["🐝", "abelha"],
      ["🐞", "joaninha"], ["🐱", "gato"], ["🐶", "cachorro"], ["🦄", "unicórnio"],
    ],
  },
  {
    titulo: "Sinais e objetos",
    itens: [
      ["✅", "certo confirmado feito check"], ["☑️", "check marcado"], ["✔️", "check certo"], ["❌", "errado não x cancelado"],
      ["✖️", "x multiplicação"], ["⚠️", "atenção aviso cuidado alerta"], ["❗", "exclamação importante"],
      ["‼️", "exclamação dupla urgente"], ["❓", "interrogação dúvida pergunta"], ["💯", "cem por cento nota dez"],
      ["🆗", "ok"], ["🆕", "novo novidade lançamento"], ["🆙", "up subiu"], ["🔝", "topo top"], ["🔜", "em breve"],
      ["📌", "alfinete fixado"], ["📍", "localização endereço pino"], ["📎", "clipe anexo"], ["🔔", "sino notificação"],
      ["🔕", "sino silenciado"], ["⏰", "despertador hora alarme"], ["⌛", "ampulheta tempo"], ["⏳", "ampulheta esperando"],
      ["📅", "calendário data"], ["🗓️", "calendário agenda"], ["📆", "calendário"], ["📞", "telefone ligar"],
      ["☎️", "telefone"], ["📱", "celular whatsapp"], ["💬", "balão mensagem conversa"], ["🗨️", "balão fala"],
      ["✉️", "envelope email carta"], ["📩", "envelope recebido"], ["📤", "enviado caixa de saída"],
      ["📥", "recebido caixa de entrada"], ["📝", "anotação memorando lista"], ["✏️", "lápis escrever"],
      ["🖊️", "caneta"], ["🔍", "lupa pesquisar procurar"], ["🔒", "cadeado fechado seguro"], ["🔓", "cadeado aberto"],
      ["🔑", "chave"], ["💡", "lâmpada ideia dica"], ["📸", "foto câmera flash"], ["📷", "câmera foto"],
      ["🎥", "vídeo câmera filmar"], ["📣", "megafone anúncio"], ["📢", "alto-falante aviso anúncio"],
      ["🔗", "link corrente"], ["♻️", "reciclagem"], ["🚫", "proibido"], ["🔞", "dezoito maiores"], ["💤", "zzz dormindo"],
      ["🌀", "espiral"], ["➕", "mais soma"], ["➖", "menos"], ["➡️", "seta direita"], ["⬅️", "seta esquerda"],
      ["⬆️", "seta cima"], ["⬇️", "seta baixo"], ["↩️", "voltar seta"], ["🔄", "atualizar girar"],
    ],
  },
];

/** A grade que o compositor desenha (mesma ordem de sempre). */
export const EMOJI_GROUPS: { titulo: string; emojis: string[] }[] = GRUPOS.map((g) => ({
  titulo: g.titulo,
  emojis: g.itens.map(([e]) => e),
}));

/** Palavras de cada emoji, já normalizadas (sem acento, minúsculas). */
const PALAVRAS = new Map<string, string>();
for (const g of GRUPOS) {
  for (const [emoji, palavras] of g.itens) {
    PALAVRAS.set(emoji, `${normalizar(palavras)} ${normalizar(g.titulo)}`);
  }
}

function normalizar(t: string): string {
  return t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

/**
 * Os emojis que casam com o que foi digitado, na ordem da grade.
 * Termo vazio = `null` (a tela mostra a grade inteira, por grupo).
 */
export function buscarEmojis(termo: string): string[] | null {
  const t = normalizar(termo);
  if (!t) return null;
  const achados: string[] = [];
  for (const g of GRUPOS) {
    for (const [emoji] of g.itens) {
      if (PALAVRAS.get(emoji)!.includes(t)) achados.push(emoji);
    }
  }
  return achados;
}
