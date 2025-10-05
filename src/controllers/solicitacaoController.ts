// src/controllers/solicitacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const solicitacaoSchema = z.object({
  responsavel_usuario_id: z.number().int(),
  setor_equipamento: z.string().optional(),
  numero_glpi: z.string().optional(),
  patrimonio: z.string().optional(),
  unidade_id: z.number().int(),
  itens: z.array(z.object({
    id: z.number().int(),
    quantidade: z.number().int().positive(),
  })).min(1, "A solicitação deve ter pelo menos um item."),
});

// Listar solicitações com filtros
export const getAllSolicitacoes = async (req: Request, res: Response) => {
  const { unidade_id, status, tecnico_id_filtro } = req.query;
  const where: any = {};

  if (unidade_id) where.unidade_id = Number(unidade_id);
  if (status) where.status = String(status);
  if (tecnico_id_filtro) where.responsavel_usuario_id = Number(tecnico_id_filtro);

  const solicitacoes = await prisma.solicitacoes.findMany({
    where,
    include: {
        usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } }
    },
    orderBy: { data_solicitacao: 'desc' }
  });
  res.json(solicitacoes);
};

// Criar nova solicitação com transação
export const createSolicitacao = async (req: Request, res: Response) => {
  try {
    const { itens, ...solicitacaoData } = solicitacaoSchema.parse(req.body);
    const usuario_id = req.user!.id; // Pega o ID do usuário logado pelo token

    // Prisma Transaction: ou tudo funciona, ou nada é salvo no banco
    const novaSolicitacao = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Cria o registro principal da solicitação
      const solicitacao = await tx.solicitacoes.create({
        data: { ...solicitacaoData, usuario_id },
      });

      // 2. Itera sobre os itens do carrinho
      for (const item of itens) {
        // 3. Adiciona o item à tabela de junção 'solicitacao_itens'
        await tx.solicitacao_itens.create({
          data: {
            solicitacao_id: solicitacao.id,
            item_id: item.id,
            quantidade_solicitada: item.quantidade,
          },
        });

        // 4. Atualiza (diminui) a quantidade no estoque
        await tx.itens.update({
          where: { id: item.id },
          data: {
            quantidade: {
              decrement: item.quantidade,
            },
          },
        });
      }
      return solicitacao;
    });

    res.status(201).json(novaSolicitacao);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: 'Erro ao criar solicitação.', details: error });
  }
};

export const getSolicitacaoById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const solicitacao = await prisma.solicitacoes.findUnique({
      where: { id: Number(id) },
      include: {
        // Inclui dados do solicitante, do responsável e os itens da solicitação
        usuarios_solicitacoes_usuario_idTousuarios: { select: { nome_completo: true } },
        usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } },
        solicitacao_itens: {
          include: {
            itens: true, // Inclui todos os dados do item
          }
        }
      }
    });
    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada.' });
    }
    res.json(solicitacao);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar solicitação.' });
  }
};

export const updateStatusSolicitacao = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status } = req.body;

    if (!status) {
        return res.status(400).json({ message: 'O campo status é obrigatório.' });
    }

    try {
        const solicitacao = await prisma.solicitacoes.update({
            where: { id: Number(id) },
            data: { status },
        });
        res.json(solicitacao);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar status.' });
    }
};

export const getLatestSolicitacoes = async (req: Request, res: Response) => {
    const { id: userId, role, unidade_id } = req.user!;

    try {
        let whereClause: any = {};
        if (role === 'gerente') {
            whereClause = { unidade_id: unidade_id };
        } else if (role === 'tecnico') {
            whereClause = { responsavel_usuario_id: userId };
        }

        const solicitacoes = await prisma.solicitacoes.findMany({
            where: whereClause,
            take: 5,
            orderBy: { data_solicitacao: 'desc' },
            include: {
                usuarios_solicitacoes_responsavel_usuario_idTousuarios: { 
                    select: { nome_completo: true } 
                },
            }
        });

        const response = solicitacoes.map((s) => ({
            id: s.id,
            data_solicitacao: s.data_solicitacao,
            status: s.status,
            tecnico_responsavel: s.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Técnico não encontrado',
        }));

        res.json(response);

    } catch (error) {
        console.error("Erro ao buscar últimas solicitações:", error);
        res.status(500).json({ message: 'Erro ao buscar últimas solicitações.' });
    }
};

export const updateSolicitacaoItemStatus = async (req: Request, res: Response) => {
    const { itemId } = req.params; // ID do 'solicitacao_itens'
    const { status_entrega } = req.body; // 'Entregue' ou 'Pendente'

    try {
        const itemAtualizado = await prisma.solicitacao_itens.update({
            where: { id: Number(itemId) },
            data: { 
                status_entrega,
                // Se o status for 'Entregue', registra a data/hora atual
                data_entrega: status_entrega === 'Entregue' ? new Date() : null
            },
        });
        res.json(itemAtualizado);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar o status do item.' });
    }
};