import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// 1. Gestão de Carga (Atribuição e Devolução)
export const atribuirBem = async (req: Request, res: Response) => {
  const { bem_id, tecnico_id, observacoes } = req.body;
  try {
    const atribuicao = await prisma.atribuicaoTecnico.create({
      data: { bem_id, tecnico_id, observacoes }
    });
    // Atualiza status do bem se necessário
    res.status(201).json(atribuicao);
  } catch (error) {
    res.status(500).json({ message: "Erro ao atribuir bem." });
  }
};

export const devolverBem = async (req: Request, res: Response) => {
  const { id } = req.params; // ID da Atribuição
  try {
    await prisma.atribuicaoTecnico.update({
      where: { id: Number(id) },
      data: { data_devolucao: new Date() }
    });
    res.json({ message: "Devolução registrada com sucesso." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao registrar devolução." });
  }
};

// 2. Logística de Transferência
export const registrarTransferencia = async (req: Request, res: Response) => {
  const { bem_id, destino_unidade_id, tipo, subtipo } = req.body;
  const origem_unidade_id = req.user?.unidade_id; // Pego do token do usuário logado

  try {
    const mov = await prisma.movimentacaoBem.create({
      data: {
        bem_id,
        tipo, // "TRANSFERENCIA" ou "RECOLHIMENTO"
        subtipo, // "Inservível" ou "Ocioso"
        origem_unidade_id: Number(origem_unidade_id),
        destino_unidade_id: destino_unidade_id ? Number(destino_unidade_id) : null
      }
    });
    
    // Se for transferência, atualiza o status do bem
    if (tipo === "TRANSFERENCIA") {
      await prisma.bemPatrimonial.update({
        where: { id: bem_id },
        data: { status_atual: "Transferido" }
      });
    }

    res.status(201).json(mov);
  } catch (error) {
    res.status(500).json({ message: "Erro ao registrar movimentação." });
  }
};

// 3. Upload de Foto
export const uploadFotoBem = async (req: Request, res: Response) => {
  const { id } = req.params;
  const arquivo = (req as any).file;

  if (!arquivo) return res.status(400).json({ message: "Nenhuma foto enviada." });

  try {
    const foto_url = `/uploads/patrimonio/${arquivo.filename}`;
    await prisma.bemPatrimonial.update({
      where: { id: Number(id) },
      data: { foto_url }
    });
    res.json({ foto_url });
  } catch (error) {
    res.status(500).json({ message: "Erro ao salvar foto." });
  }
};