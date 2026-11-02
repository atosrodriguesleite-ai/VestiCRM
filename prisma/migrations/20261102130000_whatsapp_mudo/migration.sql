-- RN-105: a loja conectada e MUDA (nenhuma mensagem de cliente há 24 h) passa
-- a ser avisada pelo vigia — uma vez por episódio, com reaviso a cada 24 h.
-- O carimbo diz quando o último aviso saiu (nulo = nunca avisou).
--
-- Sem ponto de partida de propósito: diferente do pacote atrasado (RN-103),
-- aqui a loja que JÁ está muda no dia do deploy é exatamente quem precisa do
-- aviso agora (02/11/2026: quatro lojas mudas há dois dias sem ninguém saber).
ALTER TABLE "CommSettings" ADD COLUMN "silencioAvisadoEm" TIMESTAMP(3);
-- RN-105: quando alguém pediu o reinício da conexão pelo sistema — o "fechou"
-- dos 3 minutos seguintes é do reinício, não queda (lido pelo webhook e pelo vigia).
ALTER TABLE "CommSettings" ADD COLUMN "reinicioPedidoEm" TIMESTAMP(3);
