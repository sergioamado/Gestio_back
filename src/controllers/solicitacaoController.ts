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

export const getAllSolicitacoes = async (req: Request, res: Response) => {
  try {
    const { unidade_id, status, tecnico_id_filtro } = req.query;
    const where: Prisma.solicitacoesWhereInput = {};

    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (status) where.status = String(status);
    if (tecnico_id_filtro) where.responsavel_usuario_id = Number(tecnico_id_filtro);

    const solicitacoes = await prisma.solicitacoes.findMany({
      where,
      include: {
          // CORREÇÃO: Adicionado o include para os itens da solicitação
          solicitacao_itens: {
            include: {
              itens: {
                select: { descricao: true }
              }
            }
          },
          usuarios_solicitacoes_responsavel_usuario_idTousuarios: { 
              select: { nome_completo: true } 
          }
      },
      orderBy: { data_solicitacao: 'desc' }
    });
    
    const respostaFormatada = solicitacoes.map(sol => {
      const tecnicoNome = sol.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Técnico Removido';
      const { usuarios_solicitacoes_responsavel_usuario_idTousuarios, ...restoDaSolicitacao } = sol;

      return {
        ...restoDaSolicitacao,
        tecnico_responsavel: tecnicoNome,
      };
    });

    res.json(respostaFormatada);

  } catch (error) {
    console.error("Erro em getAllSolicitacoes:", error);
    res.status(500).json({ message: "Erro interno ao buscar solicitações." });
  }
};

// ... (createSolicitacao e getSolicitacaoById permanecem iguais)
export const createSolicitacao = async (req: Request, res: Response) => {
  try {
    const { itens, ...solicitacaoData } = solicitacaoSchema.parse(req.body);
    const usuario_id = req.user!.id;

    const novaSolicitacao = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const solicitacao = await tx.solicitacoes.create({
        data: { ...solicitacaoData, usuario_id },
      });

      for (const item of itens) {
        await tx.solicitacao_itens.create({
          data: {
            solicitacao_id: solicitacao.id,
            item_id: item.id,
            quantidade_solicitada: item.quantidade,
          },
        });
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
        usuarios_solicitacoes_usuario_idTousuarios: { 
          select: { nome_completo: true } 
        },
        usuarios_solicitacoes_responsavel_usuario_idTousuarios: { 
          select: { nome_completo: true } 
        },
        solicitacao_itens: {
          include: {
            itens: true,
          }
        }
      }
    });

    if (!solicitacao) {
      return res.status(404).json({ message: 'Solicitação não encontrada.' });
    }
    const respostaFormatada = {
      ...solicitacao,
      solicitante_nome: solicitacao.usuarios_solicitacoes_usuario_idTousuarios?.nome_completo || 'Solicitante não encontrado',
      tecnico_responsavel: solicitacao.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Técnico não encontrado'
    };
    delete (respostaFormatada as any).usuarios_solicitacoes_usuario_idTousuarios;
    delete (respostaFormatada as any).usuarios_solicitacoes_responsavel_usuario_idTousuarios;

    res.json(respostaFormatada);

  } catch (error) {
    console.error("Erro em getSolicitacaoById:", error);
    res.status(500).json({ message: 'Erro interno ao buscar detalhes da solicitação.' });
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
        let whereClause: Prisma.solicitacoesWhereInput = {};
        
        if (role === 'gerente') {
            whereClause = { 
                unidade_id: unidade_id ?? undefined,
                status: 'Pendente' 
            };
        } 
        else if (role.startsWith('tecnico')) {
            whereClause = { responsavel_usuario_id: userId };
        }

        const solicitacoes = await prisma.solicitacoes.findMany({
            where: whereClause,
            take: 5,
            orderBy: { data_solicitacao: 'desc' },
            include: {
                // CORREÇÃO: Usar o nome de relação correto do Prisma
                usuarios_solicitacoes_responsavel_usuario_idTousuarios: { 
                    select: { nome_completo: true } 
                },
            }
        });

        const response = solicitacoes.map((s) => ({
            id: s.id,
            data_solicitacao: s.data_solicitacao,
            status: s.status,
            tecnico_responsavel: s.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Não definido',
            numero_glpi: s.numero_glpi
        }));

        res.json(response);

    } catch (error) {
        console.error("Erro em getLatestSolicitacoes:", error);
        res.status(500).json({ message: 'Erro ao buscar últimas solicitações.' });
    }
};

export const updateSolicitacaoItemStatus = async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const { status_entrega } = req.body;

    try {
        const itemAtualizado = await prisma.solicitacao_itens.update({
            where: { id: Number(itemId) },
            data: { 
                status_entrega,
                data_entrega: status_entrega === 'Entregue' ? new Date() : null
            },
        });
        res.json(itemAtualizado);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar o status do item.' });
    }
};