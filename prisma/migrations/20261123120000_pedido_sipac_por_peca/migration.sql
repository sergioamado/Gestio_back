-- Nº do pedido SIPAC e almoxarifado passam a ser registrados por peça da OS.
-- Idempotente: funciona mesmo se as colunas já tiverem sido criadas por `prisma db push`.
ALTER TABLE "solicitacao_itens"
  ADD COLUMN IF NOT EXISTS "numero_pedido_sipac" VARCHAR(100),
  ADD COLUMN IF NOT EXISTS "almoxarifado" VARCHAR(100);

-- OS existentes: copia o antigo "Nº do Chamado Almoxarifado" (da OS) para cada peça dela,
-- sem sobrescrever peças que já tenham número próprio.
-- A coluna antiga é mantida (sem uso) para preservar o histórico.
UPDATE "solicitacao_itens" si
SET "numero_pedido_sipac" = btrim(s."numero_pedido_externo")
FROM "solicitacoes" s
WHERE si."solicitacao_id" = s."id"
  AND si."numero_pedido_sipac" IS NULL
  AND s."numero_pedido_externo" IS NOT NULL
  AND btrim(s."numero_pedido_externo") <> '';
