// src/controllers/unidadeController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const unidadeSchema = z.object({
  nome: z.string().min(3),
  sigla: z.string().optional(),
  campus: z.string().optional(),
});

export const getAllUnidades = async (req: Request, res: Response) => {
  const unidades = await prisma.unidades_organizacionais.findMany({
    orderBy: { nome: 'asc' },
  });
  res.json(unidades);
};

export const createUnidade = async (req: Request, res: Response) => {
  try {
    const data = unidadeSchema.parse(req.body);
    const novaUnidade = await prisma.unidades_organizacionais.create({ data });
    res.status(201).json(novaUnidade);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos.', details: error });
  }
};

export const updateUnidade = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = unidadeSchema.parse(req.body);
    const unidade = await prisma.unidades_organizacionais.update({
      where: { id: Number(id) },
      data,
    });
    res.json(unidade);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos ou unidade não encontrada.' });
  }
};

export const deleteUnidade = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.unidades_organizacionais.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar. A unidade pode estar associada a usuários ou itens.' });
  }
};