-- MENSAGENS DA LISTA "QUEM CHAMAR HOJE" — personalizáveis por loja
--
-- Os textos nasceram fixos no código. Só que cada loja fala do seu jeito: a
-- mensagem que não parece da loja soa como robô e a cliente sente na hora.
-- Mesmo caminho que já valia para a mensagem do catálogo e a de confirmação
-- de pedido (`catalogLinkMsg` e `orderMsg`).
--
-- Vazio (NULL) = a loja ainda não personalizou e usa o padrão do sistema.
-- Nenhuma loja precisa fazer nada: nada muda até alguém editar.

ALTER TABLE "CommSettings" ADD COLUMN "msgAniversario" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "msgRecompra" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "msgPosVenda" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "msgPrimeiroContato" TEXT;
ALTER TABLE "CommSettings" ADD COLUMN "msgConversaParada" TEXT;
