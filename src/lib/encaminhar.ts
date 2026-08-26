/**
 * TETO DE DESTINOS AO ENCAMINHAR uma mensagem.
 *
 * Cada destino é um envio DE VERDADE, um atrás do outro, com o ritmo humano
 * anti-bloqueio (RN-017: 4 a 9 segundos quando a conversa está fora da janela
 * de 24h). Cinco já ocupa quase todo o tempo que a função tem para trabalhar.
 *
 * E o teto tem um segundo motivo, mais importante: mandar a mesma mensagem
 * para a base inteira é DISPARO EM MASSA, que tem tela própria (Campanhas),
 * com termo de aceite, ritmo e registro. Encaminhar não pode virar uma porta
 * dos fundos para isso — é o tipo de atalho que derruba o WhatsApp da loja.
 *
 * Mora aqui (e não na rota) porque a tela e o servidor precisam do MESMO
 * número: rota do Next não pode exportar qualquer coisa.
 */
export const TETO_DESTINOS = 5;
