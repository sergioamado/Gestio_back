// src/controllers/servicosController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';

const prisma = new PrismaClient();


// VALIDAÇÕES (ZOD)

// Validação para quando o gestor cria/edita um serviço no catálogo
const catalogoSchema = z.object({
  nome_servico: z.string().min(1, "O nome do serviço é obrigatório"),
  categoria: z.string().min(1, "A categoria é obrigatória"),
  valor_estimado: z.number().min(0, "O valor não pode ser negativo"),
  ativo: z.boolean().optional().default(true),
});

// Validação para quando o técnico regista o fechamento de um serviço
const producaoSchema = z.object({
  servico_id: z.number().int("O ID do serviço deve ser um inteiro"),
  solicitacao_peca_id: z.number().int().optional().nullable(),
  atendimento_impr_id: z.number().int().optional().nullable(),
  manutencao_eletr_id: z.number().int().optional().nullable(),
  numero_glpi:z.string().optional().nullable(),
  patrimonio_serie: z.string().optional().nullable(),
  observacoes: z.string().optional().nullable(),
});


// GESTÃO DO CATÁLOGO DE SERVIÇOS (Apenas Gestor/Admin)


export const getCatalogo = async (req: Request, res: Response) => {
  try {
    const catalogo = await prisma.catalogoServico.findMany({
      orderBy: { categoria: 'asc' } // Organiza alfabeticamente por categoria
    });
    res.json(catalogo);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar catálogo de serviços.' });
  }
};

export const createCatalogoItem = async (req: Request, res: Response) => {
  try {
    const data = catalogoSchema.parse(req.body);
    const novoServico = await prisma.catalogoServico.create({ data });
    res.status(201).json(novoServico);
  } catch (error: any) {
    res.status(400).json({ message: 'Erro ao criar serviço no catálogo.', details: error.errors });
  }
};

export const updateCatalogoItem = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = catalogoSchema.parse(req.body);
    const servicoAtualizado = await prisma.catalogoServico.update({
      where: { id: Number(id) },
      data
    });
    res.json(servicoAtualizado);
  } catch (error: any) {
    res.status(400).json({ message: 'Erro ao atualizar serviço no catálogo.', details: error.errors });
  }
};


// REGISTO DE PRODUÇÃO (Quando o Técnico finaliza uma OS)


export const registrarProducao = async (req: Request, res: Response) => {
  try {
    const data = producaoSchema.parse(req.body);
    const tecnico_id = req.user!.id; // Pega o ID de quem está logado

    // Validar se o usuário enviou pelo menos um vínculo (uma OS para fechar)
    if (!data.solicitacao_peca_id && !data.atendimento_impr_id && !data.manutencao_eletr_id && !data.numero_glpi) {
      return res.status(400).json({ message: "É obrigatório vincular este serviço a uma OS interna ou informar o número do GLPI." });
    }

    //  Buscar o valor do serviço no momento (para congelar o preço no histórico)
    const servico = await prisma.catalogoServico.findUnique({
      where: { id: data.servico_id }
    });

    if (!servico) {
      return res.status(404).json({ message: "Serviço não encontrado no catálogo." });
    }

    // O valor do serviço está congelado agora
    const valor_servico_aplicado = Number(servico.valor_estimado);
    let valor_pecas_aplicado = 0;

    //  SE ESTIVER VINCULADO A UMA SOLICITAÇÃO DE PEÇAS (OS): Calcular o custo das peças gastas
    if (data.solicitacao_peca_id) {
        // Busca os itens que foram entregues ao técnico nessa OS
        const itensDaSolicitacao = await prisma.solicitacao_itens.findMany({
            where: { solicitacao_id: data.solicitacao_peca_id, status_entrega: 'Entregue' },
            include: { itens: true }
        });

        // Soma o valor (quantidade * preço unitário da peça)
        valor_pecas_aplicado = itensDaSolicitacao.reduce((total, item) => {
            const preco = item.itens?.preco_unitario ? Number(item.itens.preco_unitario) : 0;
            return total + (preco * item.quantidade_solicitada);
        }, 0);
    }
    
    // (Opcional) No futuro, pode adicionar a mesma lógica para buscar peças usadas na Manutenção Eletrónica ou nas Impressoras.

    //  Gravar a Produção no Banco
    const producao = await prisma.producaoServico.create({
      data: {
        tecnico_id,
        servico_id: data.servico_id,
        solicitacao_peca_id: data.solicitacao_peca_id,
        atendimento_impr_id: data.atendimento_impr_id,
        manutencao_eletr_id: data.manutencao_eletr_id,
        numero_glpi: data.numero_glpi,
        patrimonio_serie: data.patrimonio_serie,
        observacoes: data.observacoes,
        valor_servico_aplicado,
        valor_pecas_aplicado,
        valor_total_produzido: valor_servico_aplicado + valor_pecas_aplicado // Mão de obra + Material
      }
    });

    res.status(201).json({ message: "Produção registada com sucesso!", producao });

  } catch (error: any) {
    console.error("Erro ao registar produção:", error);
    res.status(400).json({ message: 'Erro ao registar produção.', details: error.errors || error.message });
  }
};

export const getHistoricoProducao = async (req: Request, res: Response) => {
  try {
    // Busca todo o histórico (admin/gestor) ou apenas do técnico que está logado
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
    // Permite que o Admin/Gerente exclua, ou o próprio técnico exclua o seu registo
    const producao = await prisma.producaoServico.findUnique({ where: { id: Number(id) } });
    if (!producao) return res.status(404).json({ message: 'Produção não encontrada.' });

    if (req.user?.role !== 'admin' && req.user?.role !== 'gerente' && req.user?.id !== producao.tecnico_id) {
      return res.status(403).json({ message: 'Sem permissão para excluir este registo.' });
    }

    await prisma.producaoServico.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao excluir registo de produção.' });
  }
};