// src/controllers/solicitacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();

const solicitacaoSchema = z.object({
  responsavel_usuario_id: z.number().int(),
  numero_glpi: z.number().int("O número do GLPI deve ser um número inteiro."),
  setor_equipamento: z.string().optional().nullable(),
  patrimonio: z.string().optional().nullable(),
  unidade_id: z.number().int(),
  tipo_requisicao: z.enum(['PEDIDO', 'TESTE']).default('PEDIDO'),
  justificativa: z.string().optional().nullable(),
  itens: z.array(z.object({
    id: z.number().int(),
    quantidade: z.number().int().positive(),
  })).min(1, "A solicitação deve ter pelo menos um item."),
});

export const getAllSolicitacoes = async (req: Request, res: Response) => {
  try {
    const { unidade_id, status, tecnico_id_filtro, numero_glpi } = req.query;
    const where: any = {};

    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (status) where.status = String(status);
    if (tecnico_id_filtro) where.responsavel_usuario_id = Number(tecnico_id_filtro);
    
    if (numero_glpi) where.numero_glpi = Number(numero_glpi);

    const solicitacoes = await prisma.solicitacoes.findMany({
      where: where as any, 
      include: {
        solicitacao_itens: {
          include: {
            itens: { 
              select: { descricao: true, is_permanente: true } 
            }
          }
        },
        usuarios_solicitacoes_responsavel_usuario_idTousuarios: { 
          select: { nome_completo: true } 
        }
      },
      orderBy: { data_solicitacao: 'desc' }
    });
    
    const respostaFormatada = solicitacoes.map((sol: any) => ({
      ...sol,
      tecnico_responsavel: sol.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Técnico Removido',
    }));

    res.json(respostaFormatada);
  } catch (error) {
    console.error("Erro em getAllSolicitacoes:", error);
    res.status(500).json({ message: "Erro interno ao buscar solicitações." });
  }
};

export const createSolicitacao = async (req: Request, res: Response) => {
  try {
    const validatedData = solicitacaoSchema.parse(req.body);
    const { itens, justificativa, ...solicitacaoData } = validatedData;
    const usuario_id = req.user!.id;

    const novaSolicitacao = await prisma.$transaction(async (tx) => {
      
      const solicitacao = await tx.solicitacoes.create({
         data: {
           responsavel_usuario_id: validatedData.responsavel_usuario_id,
           
           numero_glpi: String(validatedData.numero_glpi), 
           
           setor_equipamento: validatedData.setor_equipamento,
           patrimonio: validatedData.patrimonio,
           unidade_id: validatedData.unidade_id,
           tipo_requisicao: validatedData.tipo_requisicao,
           usuario_id: validatedData.responsavel_usuario_id,
           justificativa: validatedData.justificativa
         }
       });

      for (const item of itens) {
        const itemDb = await tx.itens.findUnique({ where: { id: item.id } });
        if (!itemDb || itemDb.quantidade < item.quantidade) {
          throw new Error(`Estoque insuficiente para o item: ${itemDb?.descricao || item.id}`);
        }

        await tx.solicitacao_itens.create({
          data: {
            solicitacao_id: solicitacao.id,
            item_id: item.id,
            quantidade_solicitada: item.quantidade,
          },
        });

        await tx.itens.update({
          where: { id: item.id },
          data: { quantidade: { decrement: item.quantidade } },
        });
      }
      return solicitacao;
    });

    res.status(201).json(novaSolicitacao);
  } catch (error: any) {
    console.error(error);
    res.status(400).json({ message: error.message || 'Erro ao criar solicitação.' });
  }
};


export const getSolicitacaoById = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const solicitacao = await prisma.solicitacoes.findUnique({
      where: { id: Number(id) },
      include: {
        usuarios_solicitacoes_usuario_idTousuarios: { select: { nome_completo: true } },
        usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } },
        solicitacao_itens: { include: { itens: true } }
      }
    });

    if (!solicitacao) return res.status(404).json({ message: 'Solicitação não encontrada.' });

    res.json({
      ...solicitacao,
      solicitante_nome: (solicitacao as any).usuarios_solicitacoes_usuario_idTousuarios?.nome_completo || 'Solicitante não encontrado',
      tecnico_responsavel: (solicitacao as any).usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Técnico não encontrado'
    });
  } catch (error) {
    console.error("Erro em getSolicitacaoById:", error);
    res.status(500).json({ message: 'Erro interno ao buscar detalhes.' });
  }
};


export const updateStatusSolicitacao = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { status, nova_justificativa } = req.body;

    if (!status) return res.status(400).json({ message: 'O status é obrigatório.' });

    try {
        const solicitacaoAtual = await prisma.solicitacoes.findUnique({ where: { id: Number(id) } });
        
        const justificativaAtualizada = nova_justificativa 
            ? `${(solicitacaoAtual as any)?.justificativa || ''}\n[${new Date().toLocaleString()}] Admin: ${nova_justificativa}`
            : (solicitacaoAtual as any)?.justificativa;

        const solicitacao = await prisma.solicitacoes.update({
            where: { id: Number(id) },
            data: { status, justificativa: justificativaAtualizada } as any, // Bypass TS(2339) para justificativa
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
            whereClause = { unidade_id: unidade_id ?? undefined, status: 'PENDENTE' };
        } else if (role.startsWith('tecnico')) {
            whereClause = { responsavel_usuario_id: userId };
        }

        const solicitacoes = await prisma.solicitacoes.findMany({
            where: whereClause,
            take: 5,
            orderBy: { data_solicitacao: 'desc' },
            include: {
                usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } },
            }
        });

        res.json(solicitacoes.map((s: any) => ({
            id: s.id,
            data_solicitacao: s.data_solicitacao,
            status: s.status,
            tecnico_responsavel: s.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Não definido',
            numero_glpi: s.numero_glpi
        })));
    } catch (error) {
        console.error("Erro em getLatestSolicitacoes:", error);
        res.status(500).json({ message: 'Erro ao buscar dados do dashboard.' });
    }
};


export const updateSolicitacaoItemStatus = async (req: Request, res: Response) => {
    const { itemId } = req.params;
    const { status_entrega } = req.body;

    try {
        const solicitacaoItem = await prisma.solicitacao_itens.findUnique({
            where: { id: Number(itemId) }
        });

        if (!solicitacaoItem) {
            return res.status(404).json({ message: 'Item da solicitação não encontrado.' });
        }

        const resultado = await prisma.$transaction(async (tx) => {
            const itemAtualizado = await tx.solicitacao_itens.update({
                where: { id: Number(itemId) },
                data: { 
                    status_entrega,
                    data_entrega: status_entrega === 'Entregue' ? new Date() : solicitacaoItem.data_entrega
                },
            });

            if (status_entrega === 'Devolvido' && solicitacaoItem.status_entrega !== 'Devolvido') {
                await tx.itens.update({
                    where: { id: solicitacaoItem.item_id },
                    data: { quantidade: { increment: solicitacaoItem.quantidade_solicitada } }
                });
            }

            return itemAtualizado;
        });

        res.json(resultado);
    } catch (error) {
        console.error("Erro em updateSolicitacaoItemStatus:", error);
        res.status(500).json({ message: 'Erro ao atualizar status do item.' });
    }
};