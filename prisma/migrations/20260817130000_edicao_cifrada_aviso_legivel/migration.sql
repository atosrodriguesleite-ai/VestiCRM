-- EDIÇÃO CIFRADA VIRAVA BOLHA ENIGMÁTICA (incidente Giovana, 13/08/2026).
--
-- Quando a cliente editava uma mensagem e o aviso chegava criptografado SEM
-- dizer qual mensagem mudou, a conversa ganhava uma bolha
-- "[mensagem não exibida aqui — abra o WhatsApp para ver]
-- (secretEncryptedMessage)" — código de programador na cara da vendedora.
--
-- O webhook novo resgata o texto no servidor da loja quando dá, e quando não
-- dá escreve um aviso honesto em português. Esta migração conserta as bolhas
-- que JÁ nasceram erradas nas conversas (o texto novo em si é irrecuperável:
-- veio cifrado e o aviso não diz o alvo — o que dá para fazer é avisar
-- direito). Igualdade EXATA no corpo: nenhuma outra mensagem casa com isso.
--
-- Reexecutável: na segunda passada o WHERE não encontra mais nada.

-- Bolha na fala da CLIENTE: foi ela que editou.
UPDATE "Message"
   SET body = '✏️ A cliente editou uma mensagem e o texto novo não chegou — confira no WhatsApp.'
 WHERE body = '[mensagem não exibida aqui — abra o WhatsApp para ver] (secretEncryptedMessage)'
   AND direction = 'IN';

-- Bolha na fala da LOJA (edição feita pelo celular da loja): dizer
-- "a cliente editou" aqui seria informação errada na conversa.
UPDATE "Message"
   SET body = '✏️ Uma mensagem enviada pela loja foi editada no celular e o texto novo não chegou — confira no WhatsApp.'
 WHERE body = '[mensagem não exibida aqui — abra o WhatsApp para ver] (secretEncryptedMessage)'
   AND direction = 'OUT';
