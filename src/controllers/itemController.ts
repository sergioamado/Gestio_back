// src/controllers/itemController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

// Schema de validação para criar/atualizar um item
const itemSchema = z.object({
  codigo_sipac: z.string().optional(),
  pregao: z.string().optional(),
  descricao: z.string().min(3, "Descrição é obrigatória"),
  tipo: z.string().optional(),
  unidade_medida: z.string(),
  localizacao: z.string().optional(),
  quantidade: z.number().int().min(0),
  preco_unitario: z.number().min(0),
  unidade_id: z.number().int(),
});

// Listar todos os itens (com filtro opcional por unidade)
export const getAllItems = async (req: Request, res: Response) => {
  const { unidadeId } = req.query;
  try {
    const items = await prisma.itens.findMany({
      where: {
        unidade_id: unidadeId ? Number(unidadeId) : undefined,
      },
      include: {
        unidades_organizacionais: {
          select: {
            nome: true,
          },
        },
      },
      orderBy: { descricao: 'asc' },
    });
    res.json(items);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar itens.' });
  }
};

// Criar um novo item
export const createItem = async (req: Request, res: Response) => {
  try {
    const data = itemSchema.parse(req.body);
    const newItem = await prisma.itens.create({ data });
    res.status(201).json(newItem);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos.', details: error });
  }
};

// Atualizar um item existente
export const updateItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = itemSchema.parse(req.body);
    const updatedItem = await prisma.itens.update({
      where: { id: Number(id) },
      data,
    });
    res.json(updatedItem);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos ou item não encontrado.', details: error });
  }
};

// Deletar um item
export const deleteItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    await prisma.itens.delete({
      where: { id: Number(id) },
    });
    res.status(204).send(); // 204 No Content
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar item. Pode estar em uso em uma solicitação.' });
  }
};