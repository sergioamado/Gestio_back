-- Bens atribuídos a técnicos ficavam com a situação "Transferido", como se tivessem saído da
-- unidade (e sumiam da Auditoria Física, que só lista bens "Ativo").
-- Agora a atribuição NÃO muda a situação: o bem continua "Ativo" na unidade, com o técnico.
-- Esta migração corrige os bens que já estavam assim. Só mexe nos que têm termo de cautela aberto.
UPDATE "BemPatrimonial" AS b
SET "status_atual" = 'Ativo'
WHERE b."status_atual" = 'Transferido'
  AND EXISTS (
    SELECT 1 FROM "AtribuicaoTecnico" a
    WHERE a."bem_id" = b."id" AND a."data_devolucao" IS NULL
  );
