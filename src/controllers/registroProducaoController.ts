// src/controllers/registroProducaoController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { dispararNotificacao } from './notificacaoController';

const prisma = new PrismaClient();

//  ZOD: Agora 'servicos' é um Array de objetos para podermos receber a quantidade!
const producaoSchema = z.object({
  servicos: z.array(z.object({
    id: z.number(),
    quantidade: z.number().min(1).default(1)
  })).min(1, "Selecione pelo menos um serviço."),
  observacoes: z.string().nullable().optional(),
  patrimonio_serie: z.string().nullable().optional(),
  tipo_vinculo: z.string().optional(),
  vinculo_id: z.union([z.string(), z.number()]).optional(),
  solicitacao_peca_id: z.number().nullable().optional(),
  atendimento_impr_id: z.number().nullable().optional(),
  manutencao_eletr_id: z.number().nullable().optional(),
  numero_glpi: z.string().nullable().optional(),
});


// REGISTRO DE PRODUÇÃO
export const registrarProducao = async (req: Request, res: Response) => {
  try {
    const validData = producaoSchema.parse(req.body);
    const tecnico_id = req.user!.id;

    if (!validData.solicitacao_peca_id && !validData.atendimento_impr_id && !validData.manutencao_eletr_id && !validData.numero_glpi) {
      return res.status(400).json({ message: "É obrigatório vincular este serviço a uma OS interna ou informar o número do GLPI." });
    }

    //  1. EXTRAÇÃO AUTOMÁTICA DO PATRIMÓNIO E GLPI
    let patrimonioFinal = validData.patrimonio_serie;
    let glpiFinal = validData.numero_glpi;
    let responsavelOsId = null;

    if (validData.solicitacao_peca_id) {
        const os = await prisma.solicitacoes.findUnique({
            where: { id: validData.solicitacao_peca_id }
        });
        
        if (os) {
            patrimonioFinal = os.patrimonio || patrimonioFinal;
            glpiFinal = os.numero_glpi ? String(os.numero_glpi) : glpiFinal;
            responsavelOsId = os.responsavel_usuario_id; 
        }
    }

    //  2. CALCULAR O CUSTO DAS PEÇAS USADAS
    let valor_pecas_total = 0;
    if (validData.solicitacao_peca_id) {
        const itensDaSolicitacao = await prisma.solicitacao_itens.findMany({
            where: { 
              solicitacao_id: validData.solicitacao_peca_id, 
              status_entrega: { in: ['Entregue', 'Recebida pelo Técnico'] } 
            },
            include: { itens: true }
        });

        valor_pecas_total = itensDaSolicitacao.reduce((total, item) => {
            const preco = item.itens?.preco_unitario ? Number(item.itens.preco_unitario) : 0;
            return total + (preco * item.quantidade_solicitada);
        }, 0);
    }

    //  3. GRAVAR O CARRINHO
    let servicosGravados = 0;

    for (let i = 0; i < validData.servicos.length; i++) {
        const itemServico = validData.servicos[i]; //  Objeto com id e quantidade
        
        const servicoDB = await prisma.catalogoServico.findUnique({ where: { id: itemServico.id } });
        if (!servicoDB) continue;

        //  O valor do serviço agora é multiplicado pela quantidade!
        const valor_servico_base = Number(servicoDB.valor_estimado);
        const valor_servico_aplicado = valor_servico_base * itemServico.quantidade;
        
        // As peças só são cobradas no 1º serviço
        const valor_pecas_aplicado = (i === 0) ? valor_pecas_total : 0;

        await prisma.producaoServico.create({
            data: {
                tecnico_id,
                servico_id: itemServico.id,
                quantidade: itemServico.quantidade, //  A gravar a nova coluna!
                solicitacao_peca_id: validData.solicitacao_peca_id || null,
                atendimento_impr_id: validData.atendimento_impr_id || null,
                manutencao_eletr_id: validData.manutencao_eletr_id || null,
                numero_glpi: glpiFinal || null,
                patrimonio_serie: patrimonioFinal || null, 
                observacoes: validData.observacoes || null,
                valor_servico_aplicado,
                valor_pecas_aplicado,
                valor_total_produzido: valor_servico_aplicado + valor_pecas_aplicado
            }
        });
        servicosGravados++;
    }

    // 4. DISPARAR A NOTIFICAÇÃO PARA O GESTOR/RESPONSÁVEL
    if (servicosGravados > 0 && validData.solicitacao_peca_id && responsavelOsId) {
        try {
           await dispararNotificacao({
               usuario_id: responsavelOsId,
               titulo: ' Serviços Finalizados',
               mensagem: `O técnico acaba de lançar ${servicosGravados} serviço(s) na OS #${validData.solicitacao_peca_id}. A máquina já pode ir para vistoria.`,
               tipo: 'info',
               link_acao: '/gerenciar-solicitacoes'
           });
        } catch (notifyErr) {
           console.warn("Aviso: Falha ao enviar notificação.", notifyErr);
        }
    }

    res.status(201).json({ message: "Produção registrada com sucesso!", criados: servicosGravados });

  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ message: "Dados inválidos", detalhes: error.issues });
    }
    
    console.error("Erro ao registrar produção:", error);
    res.status(500).json({ 
      message: "Erro interno ao registrar os serviços.", 
      erroBackend: error.message 
    });
  }
};



export const getHistoricoProducao = async (req: Request, res: Response) => {
  try {
    const where = (req.user?.role === 'admin' || req.user?.role === 'gerente') 
      ? {} 
      : { tecnico_id: req.user!.id };

    const historico = await prisma.producaoServico.findMany({
      where,
      include: {
        servico: { select: { nome_servico: true, categoria: true } },
        tecnico: { select: { nome_completo: true } }
      },
      orderBy: { data_registro: 'desc' }
    });

    res.json(historico);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar o histórico de produção.' });
  }
};

export const deleteProducao = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const producao = await prisma.producaoServico.findUnique({ where: { id: Number(id) } });
    if (!producao) return res.status(404).json({ message: 'Produção não encontrada.' });

    if (req.user?.role !== 'admin' && req.user?.role !== 'gerente' && req.user?.id !== producao.tecnico_id) {
      return res.status(403).json({ message: 'Sem permissão para excluir este registro.' });
    }

    await prisma.producaoServico.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir registro de produção.' });
  }
};