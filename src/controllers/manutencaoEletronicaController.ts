// src/controllers/manutencaoEletronicaController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const manutencaoSchema = z.object({
  glpi: z.string().optional(),
  tecnico_responsavel_id: z.number().int(),
  equipamento: z.string().min(1, "O nome do equipamento é obrigatório."),
  descricao_problema: z.string().min(1, "A descrição do problema é obrigatória."),
});

export const createManutencao = async (req: Request, res: Response) => {
  try {
    const data = manutencaoSchema.parse(req.body);
    const novaManutencao = await prisma.manutencao_eletronica.create({ data });
    res.status(201).json(novaManutencao);
  } catch (error) {
    console.error("Erro ao criar manutenção:", error); // Log de erro
    res.status(400).json({ message: 'Dados inválidos.', details: error });
  }
};

export const getAllManutencoes = async (req: Request, res: Response) => {
  try {
    const manutencoes = await prisma.manutencao_eletronica.findMany({
      orderBy: { data_entrada: 'asc' },
      include: {
        tecnico_responsavel: {
          select: { nome_completo: true },
        },
      },
    });
    res.json(manutencoes);
  } catch (error) {
    console.error("Erro ao buscar a fila de manutenção:", error);
    res.status(500).json({ message: 'Erro ao buscar a fila de manutenção.' });
  }
};

export const updateStatusManutencao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;

  if (!status || !['Pendente', 'Em_manutencao', 'Concluido'].includes(status)) {
    return res.status(400).json({ message: 'Status inválido.' });
  }

  try {
    const manutencao = await prisma.manutencao_eletronica.update({
      where: { id: Number(id) },
      data: { status },
    });
    res.json(manutencao);
  } catch (error) {
    console.error("Erro ao atualizar status de manutenção:", error); // Log de erro
    res.status(500).json({ message: 'Erro ao atualizar o status.' });
  }
};

export const iniciarManutencao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const tecnicoId = req.user!.id; // ID do técnico logado

  try {
    const manutencao = await prisma.manutencao_eletronica.update({
      where: { id: Number(id) },
      data: { 
        tecnico_responsavel_id: tecnicoId,
        status: 'Em_manutencao' 
      },
    });
    res.json(manutencao);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao iniciar manutenção.' });
  }
};

export const finalizarManutencao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { laudo_tecnico } = req.body;

  if (!laudo_tecnico) {
    return res.status(400).json({ message: 'O parecer técnico é obrigatório.' });
  }

  try {
    const manutencao = await prisma.manutencao_eletronica.update({
      where: { id: Number(id) },
      data: { 
        laudo_tecnico,
        status: 'Concluido' 
      },
    });
    res.json(manutencao);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao finalizar manutenção.' });
  }
};