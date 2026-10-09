// src/controllers/solicitacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { dispararNotificacao } from './notificacaoController';
import { getIO } from '../socket';

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
    if (status) {
      if (Array.isArray(status)) {
        where.status = { in: status.map(String) };
      } else {
        where.status = String(status);
      }
    }
    if (tecnico_id_filtro) where.responsavel_usuario_id = Number(tecnico_id_filtro);
    if (numero_glpi){ 
      const glpiNumero = Number(numero_glpi);
   if (!isNaN(glpiNumero)) {
       where.numero_glpi = glpiNumero;
    }
  }

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
              itens: { select: { descricao: true, codigo_sipac: true } }
            }
          },
          usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } },
          usuarios_solicitacoes_usuario_idTousuarios: { select: { nome_completo: true } },
          unidades_organizacionais: { select: { nome: true, sigla: true } }
        },
        orderBy: { data_solicitacao: 'desc' }
      }),
      prisma.solicitacoes.count({ where: where as any })
    ]);

    res.json({
      data: solicitacoes,
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
    const usuario_id = req.user!.id; 

    const novaSolicitacao = await prisma.$transaction(async (tx) => {
      const solicitacao = await tx.solicitacoes.create({
         data: {
           responsavel_usuario_id: validatedData.responsavel_usuario_id,
           numero_glpi: validatedData.numero_glpi, 
           setor_equipamento: validatedData.setor_equipamento,
           patrimonio: validatedData.patrimonio,
           unidade_id: validatedData.unidade_id,
           tipo_requisicao: validatedData.tipo_requisicao,
           usuario_id: usuario_id,
           justificativa: validatedData.justificativa,
           status: 'PENDENTE'
         }
       });

      const isTeste = validatedData.tipo_requisicao === 'TESTE';

      for (const item of itens) {
        const itemDb = await tx.itens.findUnique({ where: { id: item.id } });
        
        if (!itemDb) throw new Error(`Item não encontrado: ${item.id}`);

        if (isTeste && itemDb.quantidade_teste < item.quantidade) {
           throw new Error(`Estoque de TESTE insuficiente para: ${itemDb.descricao}`);
        }
        if (!isTeste && itemDb.quantidade_estoque < item.quantidade) {
           throw new Error(`Estoque de CONSUMO insuficiente para: ${itemDb.descricao}`);
        }

        await tx.solicitacao_itens.create({
          data: {
            solicitacao_id: solicitacao.id,
            item_id: item.id,
            quantidade_solicitada: item.quantidade,
            tipo_uso: isTeste ? 'TESTE' : 'CONSUMO',
            status_entrega: 'Pendente'
          },
        });

        // Abater do estoque correto
        await tx.itens.update({
          where: { id: item.id },
          data: isTeste 
            ? { quantidade_teste: { decrement: item.quantidade } }
            : { quantidade_estoque: { decrement: item.quantidade } }
        });
      }
      return solicitacao;
    });

    // Notificações...
    await dispararNotificacao({
      usuario_id: usuario_id,
      titulo: '📦 Nova Ordem de Serviço',
      mensagem: `Sua solicitação GLPI ${validatedData.numero_glpi} foi gerada (Status: PENDENTE).`,
      tipo: 'sucesso', link_acao: '/gerenciar-solicitacoes'
    });
    try { getIO().emit('atualizar_estoque'); } catch(e) {}
    res.status(201).json(novaSolicitacao);
  } catch (error: any) {
    res.status(400).json({ message: error.message || 'Erro ao criar OS.' });
  }
};


export const updateSolicitacao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status, numero_pedido_externo, justificativa, itens_entrega } = req.body;
  const idUsuarioAcao = req.user!.id;

  try {
    const solicitacaoAtual = await prisma.solicitacoes.findUnique({
      where: { id: Number(id) },
      include: { solicitacao_itens: true }
    });

    if (!solicitacaoAtual) return res.status(404).json({ message: 'OS não encontrada.' });

    //  A REGRA INVIOLÁVEL: Verificar Consumo no Fechamento
    if (status === 'CONCLUIDA') {
      const consumiuPecas = solicitacaoAtual.solicitacao_itens.some(
        (item) => item.tipo_uso === 'CONSUMO' && item.status_entrega !== 'Cancelado'
      );
      
      const numeroAlmoxarifado = numero_pedido_externo !== undefined ? numero_pedido_externo : solicitacaoAtual.numero_pedido_externo;

      if (consumiuPecas && (!numeroAlmoxarifado || numeroAlmoxarifado.trim() === '')) {
        return res.status(400).json({ 
          bloqueio_regra: true,
          message: '⛔ REGRA INVIOLÁVEL: Houve consumo de peças. O Nº do Chamado Almoxarifado (Num/Ano) é obrigatório para concluir!' 
        });
      }
    }

    const resultado = await prisma.$transaction(async (tx) => {
      //  Atualizar a OS Principal
      const osAtualizada = await tx.solicitacoes.update({
        where: { id: Number(id) },
        data: {
          status: status !== undefined ? status : solicitacaoAtual.status,
          numero_pedido_externo: numero_pedido_externo !== undefined ? numero_pedido_externo : solicitacaoAtual.numero_pedido_externo,
          justificativa: justificativa !== undefined ? justificativa : solicitacaoAtual.justificativa,
        }
      });

      // Atualizar Status das Peças (Se enviado pelo Frontend)
      if (itens_entrega && Array.isArray(itens_entrega)) {
        for (const itemRequest of itens_entrega) {
          const itemDbAtual = solicitacaoAtual.solicitacao_itens.find(i => i.id === itemRequest.solicitacao_item_id);
          
          if (itemDbAtual && itemDbAtual.status_entrega !== itemRequest.status_entrega) {
            
            //  Técnico devolveu peça de CONSUMO alegando Defeito/Erro
            if (itemRequest.status_entrega === 'Devolvida' && itemDbAtual.tipo_uso === 'CONSUMO') {
                await tx.itens.update({
                    where: { id: itemDbAtual.item_id },
                    data: { quantidade_defeito: { increment: itemDbAtual.quantidade_solicitada } }
                });
            }

            //  GESTOR aceitou fisicamente o retorno de uma peça de TESTE
            // A peça volta para a gaveta de testes bons!
            if (itemRequest.status_entrega === 'Devolução Aceite' && itemDbAtual.tipo_uso === 'TESTE') {
                await tx.itens.update({
                    where: { id: itemDbAtual.item_id },
                    data: { quantidade_teste: { increment: itemDbAtual.quantidade_solicitada } }
                });
            }
            
            await tx.solicitacao_itens.update({
              where: { id: itemRequest.solicitacao_item_id },
              data: { status_entrega: itemRequest.status_entrega }
            });
          }
        }
      }
      return osAtualizada;
    });
    try { getIO().emit('atualizar_estoque'); } catch(e) {}
    res.status(200).json(resultado);

  } catch (error) {
    console.error('Erro no updateSolicitacao:', error);
    res.status(500).json({ message: 'Erro interno.' });
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
    const idUsuarioAcao = req.user!.id; 

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

        let iconeTipo = 'info';
        if (status === 'APROVADA') iconeTipo = 'sucesso';
        if (status === 'REJEITADA' || status === 'CANCELADA') iconeTipo = 'alerta';

        if (solicitacao.usuario_id !== idUsuarioAcao) {
          await dispararNotificacao({
            usuario_id: solicitacao.usuario_id,
            titulo: '🔄 Atualização de Status',
            mensagem: `A sua solicitação (GLPI: ${solicitacao.numero_glpi}) mudou para: *${status}*.${nova_justificativa ? `\n\n📝 Obs: ${nova_justificativa}` : ''}`,
            tipo: iconeTipo,
            link_acao: '/gerenciar-solicitacoes'
          });
        }

        const gestores = await prisma.usuarios.findMany({
          where: {
            OR: [
              { role: 'admin' },
              { role: 'gerente', unidade_id: solicitacao.unidade_id }
            ]
          }
        });

        console.log("🕵️‍♂️ GESTORES ENCONTRADOS PARA NOTIFICAR:", gestores.map(g => g.nome_completo));

        // Dispara para todos os gestores/admins encontrados
        for (const gestor of gestores) {
          if (gestor.id !== idUsuarioAcao) {
            await dispararNotificacao({
              usuario_id: gestor.id,
              titulo: '📊 OS Atualizada',
              mensagem: `A OS (GLPI: ${solicitacao.numero_glpi}) foi alterada para *${status}*.`,
              tipo: 'info',
              link_acao: '/gerenciar-solicitacoes'
            });
          }
        }

        // O GRITO GLOBAL FICA AQUI 
        try { getIO().emit('atualizar_tabelas_os'); } catch (err) {}
        try { getIO().emit('atualizar_estoque'); } catch(e) {}
        
        return res.json(solicitacao);
        

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Erro ao atualizar status.' });
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
            include: { solicitacoes: true, itens: true }
        });

        if (!solicitacao_itens) {
            return res.status(404).json({ message: 'Item da solicitação não encontrado.' });
        }

        if (solicitacao_itens.solicitacoes.status === 'CONCLUIDA' || solicitacao_itens.solicitacoes.status === 'CANCELADA') {
            return res.status(400).json({ message: 'Ação negada. Não é possível alterar peças de um chamado já encerrado.' });
        }

        // Gerente não pode entregar peça se a OS não estiver aprovada/em andamento
        if (status_entrega === 'Entregue' && solicitacao_itens.solicitacoes.status === 'PENDENTE') {
            return res.status(400).json({ message: 'A OS precisa ser APROVADA pelo gerente antes de entregar peças.' });
        }

        const resultado = await prisma.$transaction(async (tx) => {
            const itemAtualizado = await tx.solicitacao_itens.update({
                where: { id: Number(itemId) },
                data: { 
                    status_entrega,
                    data_entrega: status_entrega === 'Entregue' ? new Date() : solicitacao_itens.data_entrega
                },
            });

            // Gerente confirma o recebimento de uma peça CANCELADA (Volta pro estoque)
            if (status_entrega === 'Cancelado' && solicitacao_itens.status_entrega === 'Devolução Pendente (Cancelado)') {
                await tx.itens.update({
                    where: { id: solicitacao_itens.item_id },
                    data: solicitacao_itens.tipo_uso === 'TESTE' 
                      ? { quantidade_teste: { increment: solicitacao_itens.quantidade_solicitada } }
                      : { quantidade_estoque: { increment: solicitacao_itens.quantidade_solicitada } }
                });
            }

            // Gerente confirma o recebimento de uma peça com DEFEITO (Vai pro lixo/garantia)
            if (status_entrega === 'Defeito' && solicitacao_itens.status_entrega === 'Devolução Pendente (Defeito)') {
                await tx.itens.update({
                    where: { id: solicitacao_itens.item_id },
                    data: { quantidade_defeito: { increment: solicitacao_itens.quantidade_solicitada } }
                });
            }

            // Lógica antiga (caso seja uma devolução simples de teste que funcionou)
            if (status_entrega === 'Devolvido' && solicitacao_itens.status_entrega !== 'Devolvido') {
                await tx.itens.update({
                    where: { id: solicitacao_itens.item_id },
                    data: { quantidade_estoque: { increment: solicitacao_itens.quantidade_solicitada } }
                });
            }

            return itemAtualizado;
        });

        // NOTIFICAÇÃO
        await dispararNotificacao({
          usuario_id: solicitacao_itens.solicitacoes.usuario_id,
          titulo: '🛠️ Atualização de Peça/Equipamento',
          mensagem: `A peça/equipamento *${solicitacao_itens.itens.descricao}* da OS ${solicitacao_itens.solicitacoes.numero_glpi} foi marcada como: *${status_entrega}*.`,
          tipo: status_entrega === 'Entregue' ? 'sucesso' : 'info',
          link_acao: '/gerenciar-solicitacoes'
        });
        
        try { getIO().emit('atualizar_estoque'); } catch(e) {}
        res.json(resultado);
    } catch (error) {
        res.status(500).json({ message: 'Erro ao atualizar status do item.' });
    }
};


export const cancelarItemSolicitacao = async (req: Request, res: Response) => {
  const { itemId } = req.params;

  try {
    const item = await prisma.solicitacao_itens.findUnique({ 
        where: { id: Number(itemId) }, include: { solicitacoes: true }
    });
    
    if (!item) return res.status(404).json({ message: "Item não encontrado." });

    if (item.solicitacoes.status === 'CONCLUIDA' || item.solicitacoes.status === 'CANCELADA') {
        return res.status(400).json({ message: 'Ação negada. A OS já está encerrada.' });
    }

    // 🚀 O Técnico apenas avisa que quer cancelar. O estoque NÃO é alterado aqui!
    await prisma.solicitacao_itens.update({
        where: { id: Number(itemId) },
        data: { status_entrega: 'Devolução Pendente (Cancelado)' }
    });

    try { getIO().emit('atualizar_tabelas_os'); } catch(e) {}
    res.status(200).json({ message: "Intenção de cancelamento registrada. Entregue a peça ao gestor para baixa no SIPAC." });
  } catch (error) {
    res.status(500).json({ message: "Erro ao cancelar item." });
  }
};

export const sinalizarDefeitoItem = async (req: Request, res: Response) => {
  const { itemId } = req.params;

  try {
    const solicitacao_itens = await prisma.solicitacao_itens.findUnique({
      where: { id: Number(itemId) }, include: { solicitacoes: true }
    });

    if (!solicitacao_itens) return res.status(404).json({ message: "Item não encontrado." });

    if (solicitacao_itens.solicitacoes.status === 'CONCLUIDA' || solicitacao_itens.solicitacoes.status === 'CANCELADA') {
        return res.status(400).json({ message: 'Ação negada. A OS já está encerrada.' });
    }
    
    // O Técnico apenas avisa que há defeito. O estoque NÃO é alterado aqui!
    await prisma.solicitacao_itens.update({
      where: { id: Number(itemId) },
      data: { status_entrega: 'Devolução Pendente (Defeito)' }
    });

    try { getIO().emit('atualizar_tabelas_os'); } catch(e) {}
    return res.status(200).json({ message: "Defeito sinalizado. Entregue a peça ao gestor para trâmite do SIPAC." });
  } catch (error) {
    return res.status(500).json({ message: "Erro ao registrar defeito." });
  }
};


export const converterTesteEmConsumo = async (req: Request, res: Response) => {
  const { itemId } = req.params;

  try {
    const itemAtual = await prisma.solicitacao_itens.findUnique({
      where: { id: Number(itemId) },
      include: { solicitacoes: true, itens: true }
    });

    if (!itemAtual) return res.status(404).json({ message: "Item não encontrado." });
    if (itemAtual.tipo_uso !== 'TESTE') {
      return res.status(400).json({ message: "Este item não é de teste." });
    }

    const resultado = await prisma.$transaction(async (tx) => {
      //  Verifica se há estoque de consumo disponível para a peça definitiva
      if (itemAtual.itens.quantidade_estoque < itemAtual.quantidade_solicitada) {
        throw new Error(`Sem estoque de CONSUMO suficiente para a peça: ${itemAtual.itens.descricao}`);
      }

      //  Muda o status da peça de Teste para devolução
      await tx.solicitacao_itens.update({
        where: { id: Number(itemId) },
        data: { status_entrega: 'Aguardando Devolução' }
      });

      //  Desconta a peça nova do estoque de Consumo
      await tx.itens.update({
        where: { id: itemAtual.item_id },
        data: { quantidade_estoque: { decrement: itemAtual.quantidade_solicitada } }
      });

      // Adiciona a nova peça (Consumo) à OS, com status "Pendente" para o Gestor separar
      const novoItemConsumo = await tx.solicitacao_itens.create({
        data: {
          solicitacao_id: itemAtual.solicitacao_id,
          item_id: itemAtual.item_id,
          quantidade_solicitada: itemAtual.quantidade_solicitada,
          tipo_uso: 'CONSUMO',
          status_entrega: 'Pendente'
        }
      });

      // 5. Atualiza o Histórico/Justificativa da OS para não haver dúvidas
      const novaJustificativa = `${itemAtual.solicitacoes.justificativa || ''}\n[${new Date().toLocaleString('pt-BR')}] Peça de teste "${itemAtual.itens.descricao}" funcionou. Solicitada a peça definitiva de consumo. Aguardando troca.`.trim();
      
      await tx.solicitacoes.update({
        where: { id: itemAtual.solicitacao_id },
        data: { justificativa: novaJustificativa }
      });

      return novoItemConsumo;
    });

    // Opcional: Notificar o gestor para separar a peça definitiva
    await dispararNotificacao({
        usuario_id: itemAtual.solicitacoes.responsavel_usuario_id,
        titulo: '🔄 Peça de Consumo Solicitada',
        mensagem: `O técnico confirmou o teste da peça ${itemAtual.itens.descricao} na OS ${itemAtual.solicitacoes.numero_glpi}. A peça de teste será devolvida e a definitiva precisa ser separada.`,
        tipo: 'info',
        link_acao: '/gerenciar-solicitacoes'
    });
    try { getIO().emit('atualizar_estoque'); } catch(e) {}
    return res.status(200).json({ message: "Conversão realizada com sucesso!", data: resultado });
  } catch (error: any) {
    console.error(error);
    return res.status(400).json({ message: error.message || "Erro ao converter item de teste em consumo." });
  }
};