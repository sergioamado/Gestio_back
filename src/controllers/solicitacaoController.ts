// src/controllers/solicitacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { dispararNotificacao } from './notificacaoController';

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
    const { unidade_id, status, tecnico_id_filtro, numero_glpi, page = 1, limit = 10 } = req.query;
    const where: any = {};

    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (status) where.status = String(status);
    if (tecnico_id_filtro) where.responsavel_usuario_id = Number(tecnico_id_filtro);
    if (numero_glpi) where.numero_glpi = Number(numero_glpi);

    const skip = (Number(page) - 1) * Number(limit);
    const take = Number(limit);

    const [solicitacoes, total] = await Promise.all([
      prisma.solicitacoes.findMany({
        where: where as any, 
        skip,
        take,
        include: {
          solicitacao_itens: {
            include: {
              itens: { select: { descricao: true, is_permanente: true } }
            }
          },
          usuarios_solicitacoes_responsavel_usuario_idTousuarios: { 
            select: { nome_completo: true } 
          }
        },
        orderBy: { data_solicitacao: 'desc' }
      }),
      prisma.solicitacoes.count({ where: where as any })
    ]);
    
    const respostaFormatada = solicitacoes.map((sol: any) => ({
      ...sol,
      tecnico_responsavel: sol.usuarios_solicitacoes_responsavel_usuario_idTousuarios?.nome_completo || 'Técnico Removido',
    }));

    res.json({
      data: respostaFormatada,
      meta: {
        total,
        page: Number(page),
        limit: Number(limit),
        totalPages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error("Erro em getAllSolicitacoes:", error);
    res.status(500).json({ message: "Erro interno ao buscar solicitações." });
  }
};

export const createSolicitacao = async (req: Request, res: Response) => {
  try {
    const validatedData = solicitacaoSchema.parse(req.body);
    const { itens, justificativa, ...solicitacaoData } = validatedData;
    const usuario_id = req.user!.id; // Quem clicou no botão "Gerar OS"

    const novaSolicitacao = await prisma.$transaction(async (tx) => {
      const solicitacao = await tx.solicitacoes.create({
         data: {
           responsavel_usuario_id: validatedData.responsavel_usuario_id,
           numero_glpi: validatedData.numero_glpi, 
           setor_equipamento: validatedData.setor_equipamento,
           patrimonio: validatedData.patrimonio,
           unidade_id: validatedData.unidade_id,
           tipo_requisicao: validatedData.tipo_requisicao,
           usuario_id: usuario_id, // Gravando quem realmente solicitou
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

    // 🚀 NOTIFICAÇÃO: Confirmação de Criação
    await dispararNotificacao({
      usuario_id: usuario_id,
      titulo: '📦 Nova Ordem de Serviço',
      mensagem: `A sua solicitação (GLPI: ${validatedData.numero_glpi}) foi gerada com sucesso e os itens foram reservados do estoque.`,
      tipo: 'sucesso',
      link_acao: '/gerenciar-solicitacoes'
    });

    // Alerta para os Gerentes da Unidade
    const gerentes = await prisma.usuarios.findMany({
      where: {
        unidade_id: validatedData.unidade_id,
        role: 'gerente' // Procura todos os gerentes desta unidade
      }
    });

    for (const gerente of gerentes) {
      await dispararNotificacao({
        usuario_id: gerente.id,
        titulo: '🔔 Nova OS Aguardando Aprovação',
        mensagem: `Uma nova OS (GLPI: ${validatedData.numero_glpi}) foi registada na sua unidade e precisa de análise.`,
        tipo: 'info',
        link_acao: '/gerenciar-solicitacoes'
      });
    }

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
    const idUsuarioAcao = req.user!.id; // Quem clicou no botão de atualizar

    if (!status) return res.status(400).json({ message: 'O status é obrigatório.' });

    try {
        const solicitacaoAtual = await prisma.solicitacoes.findUnique({ where: { id: Number(id) } });
        if (!solicitacaoAtual) return res.status(404).json({ message: 'Solicitação não encontrada' });
        
        const justificativaAtualizada = nova_justificativa 
            ? `${(solicitacaoAtual as any)?.justificativa || ''}\n[${new Date().toLocaleString()}] Admin: ${nova_justificativa}`
            : (solicitacaoAtual as any)?.justificativa;

        const solicitacao = await prisma.solicitacoes.update({
            where: { id: Number(id) },
            data: { status, justificativa: justificativaAtualizada } as any, 
        });

        // Define a cor/ícone baseado no status
        let iconeTipo = 'info';
        if (status === 'APROVADA') iconeTipo = 'sucesso';
        if (status === 'REJEITADA' || status === 'CANCELADA') iconeTipo = 'alerta';

        //  Avisa o dono da OS (Solicitante original)
        // Só avisa se não foi ele próprio a fazer a alteração
        if (solicitacao.usuario_id !== idUsuarioAcao) {
          await dispararNotificacao({
            usuario_id: solicitacao.usuario_id,
            titulo: '🔄 Atualização de Status',
            mensagem: `A sua solicitação (GLPI: ${solicitacao.numero_glpi}) mudou para: *${status}*.${nova_justificativa ? `\n\n📝 Obs: ${nova_justificativa}` : ''}`,
            tipo: iconeTipo,
            link_acao: '/gerenciar-solicitacoes'
          });
        }

        // Avisa os Gerentes da Unidade (Para controlo operacional)
        const gerentes = await prisma.usuarios.findMany({
          where: { unidade_id: solicitacao.unidade_id, role: 'gerente' }
        });

        for (const gerente of gerentes) {
          // Garante que o gerente não recebe um aviso sobre uma ação que ele mesmo fez agora
          if (gerente.id !== idUsuarioAcao) {
            await dispararNotificacao({
              usuario_id: gerente.id,
              titulo: '📊 OS Atualizada (Dashboard)',
              mensagem: `A OS (GLPI: ${solicitacao.numero_glpi}) foi alterada para *${status}*.`,
              tipo: 'info',
              link_acao: '/gerenciar-solicitacoes'
            });
          }
        }

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
        const solicitacao_itens = await prisma.solicitacao_itens.findUnique({
            where: { id: Number(itemId) },
            include: { solicitacoes: true, itens: true } // Precisamos puxar a OS e o Item para a notificação
        });

        if (!solicitacao_itens) {
            return res.status(404).json({ message: 'Item da solicitação não encontrado.' });
        }

        const resultado = await prisma.$transaction(async (tx) => {
            const itemAtualizado = await tx.solicitacao_itens.update({
                where: { id: Number(itemId) },
                data: { 
                    status_entrega,
                    data_entrega: status_entrega === 'Entregue' ? new Date() : solicitacao_itens.data_entrega
                },
            });

            if (status_entrega === 'Devolvido' && solicitacao_itens.status_entrega !== 'Devolvido') {
                await tx.itens.update({
                    where: { id: solicitacao_itens.item_id },
                    data: { quantidade: { increment: solicitacao_itens.quantidade_solicitada } }
                });
            }

            return itemAtualizado;
        });

        // 🚀 NOTIFICAÇÃO: Status de um Item específico alterado (Entregue/Devolvido)
        await dispararNotificacao({
          usuario_id: solicitacao_itens.solicitacoes.usuario_id,
          titulo: '🛠️ Atualização de Peça/Equipamento',
          mensagem: `A peça/equipamento *${solicitacao_itens.itens.descricao}* da OS ${solicitacao_itens.solicitacoes.numero_glpi} foi marcada como: *${status_entrega}*.`,
          tipo: status_entrega === 'Entregue' ? 'sucesso' : 'info',
          link_acao: '/gerenciar-solicitacoes'
        });

        res.json(resultado);
    } catch (error) {
        console.error("Erro em updateSolicitacaoItemStatus:", error);
        res.status(500).json({ message: 'Erro ao atualizar status do item.' });
    }
};

export const cancelarItemSolicitacao = async (req: Request, res: Response) => {
  const { itemId } = req.params;

  try {
    const solicitacao_itens = await prisma.solicitacao_itens.findUnique({
      where: { id: Number(itemId) }
    });

    if (!solicitacao_itens) return res.status(404).json({ message: "Item da solicitação não encontrado." });

    await prisma.solicitacao_itens.update({
      where: { id: Number(itemId) },
      data: { status_entrega: 'Cancelado' }
    });

    await prisma.itens.update({
      where: { id: solicitacao_itens.item_id },
      data: { quantidade: { increment: solicitacao_itens.quantidade_solicitada } }
    });

    return res.status(200).json({ message: "Item cancelado e estoque restaurado." });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao cancelar item." });
  }
};

export const sinalizarDefeitoItem = async (req: Request, res: Response) => {
  const { itemId } = req.params;

  try {
    const solicitacao_itens = await prisma.solicitacao_itens.findUnique({
      where: { id: Number(itemId) }
    });

    if (!solicitacao_itens) return res.status(404).json({ message: "Item não encontrado." });

    await prisma.solicitacao_itens.update({
      where: { id: Number(itemId) },
      data: { status_entrega: 'Defeito' }
    });

    await prisma.itens.update({
      where: { id: solicitacao_itens.item_id },
      data: { quantidade: { increment: solicitacao_itens.quantidade_solicitada } }
    });

    return res.status(200).json({ message: "Peça registrada como defeituosa." });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao registrar defeito." });
  }
};