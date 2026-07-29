-- A TAREFA PASSA A GUARDAR O MOTIVO
--
-- As automações já escreviam uma explicação ótima do porquê da tarefa
-- ("Não compra há 68 dias e costuma comprar a cada 40"), mas o modelo Task
-- não tinha onde guardar: sobrava só o título. O dado mais útil da tarefa
-- era jogado fora na porta de entrada.
--
-- Sem o motivo, a vendedora abre a tarefa, não entende de onde veio, e
-- precisa sair da tela para descobrir — que é a razão de a aba Tarefas ser
-- ignorada hoje.

ALTER TABLE "Task" ADD COLUMN "description" TEXT;
