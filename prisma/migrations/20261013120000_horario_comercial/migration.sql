-- RN-079: horário de atendimento da loja (JSON por dia da semana), base do
-- tempo de resposta do BI de vendas. Nulo = sem horário → conta o dia inteiro.
ALTER TABLE "Company" ADD COLUMN "horarioComercial" TEXT;
