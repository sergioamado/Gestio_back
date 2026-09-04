// src/controllers/relatorioController.ts
import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();


// 1. RELATÓRIOS ORIGINAIS DO SISTEMA (NÃO ALTERAR - USADOS NA TELA INICIAL)


// 1. Relatório Dinâmico de Solicitações (Ideal para tabelas e exportação Excel)
export const getRelatorioSolicitacoes = async (req: Request, res: Response) => {
  try {
    const { data_inicio, data_fim, status, unidade_id, responsavel_usuario_id } = req.query;
    
    const where: Prisma.solicitacoesWhereInput = {};
    if (status) where.status = String(status);
    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (responsavel_usuario_id) where.responsavel_usuario_id = Number(responsavel_usuario_id);
    
    if (data_inicio || data_fim) {
      where.data_solicitacao = {};
      if (data_inicio) where.data_solicitacao.gte = new Date(String(data_inicio));
      if (data_fim) where.data_solicitacao.lte = new Date(String(data_fim));
    }

    const relatorio = await prisma.solicitacoes.findMany({
      where,
      include: {
        unidades_organizacionais: { select: { nome: true } },
        usuarios_solicitacoes_usuario_idTousuarios: { select: { nome_completo: true } },
        usuarios_solicitacoes_responsavel_usuario_idTousuarios: { select: { nome_completo: true } },
        solicitacao_itens: {
          include: { itens: { select: { descricao: true, is_permanente: true } } }
        }
      },
      orderBy: { data_solicitacao: 'desc' }
    });

    res.json(relatorio);
  } catch (error) {
    console.error("Erro no relatório de solicitações:", error);
    res.status(500).json({ message: 'Erro ao gerar relatório.' });
  }
};

// 2. Dados Agregados para Gráficos (Ex: Pizza de Status, Barras por Mês)
export const getDadosGraficos = async (req: Request, res: Response) => {
  try {
    const statusCount = await prisma.solicitacoes.groupBy({
      by: ['status'],
      _count: { id: true }
    });

    const tipoCount = await prisma.solicitacoes.groupBy({
      by: ['tipo_requisicao'],
      _count: { id: true }
    });

    const itensMaisSolicitados = await prisma.solicitacao_itens.groupBy({
      by: ['item_id'],
      _sum: { quantidade_solicitada: true },
      orderBy: { _sum: { quantidade_solicitada: 'desc' } },
      take: 5
    });

    const itensComNomes = await Promise.all(
      itensMaisSolicitados.map(async (item) => {
        const itemInfo = await prisma.itens.findUnique({ where: { id: item.item_id } });
        return {
          descricao: itemInfo?.descricao || 'Item Removido',
          total_solicitado: item._sum.quantidade_solicitada
        };
      })
    );

    res.json({
      grafico_status: statusCount,
      grafico_tipos: tipoCount,
      top_itens: itensComNomes
    });
  } catch (error) {
    console.error("Erro nos dados de gráficos:", error);
    res.status(500).json({ message: 'Erro ao gerar dados para os gráficos.' });
  }
};

// 3. Relatório de Posição de Estoque Atual
export const getRelatorioEstoque = async (req: Request, res: Response) => {
  try {
    const { unidade_id, is_permanente } = req.query;
    const where: Prisma.itensWhereInput = {};

    if (unidade_id) where.unidade_id = Number(unidade_id);
    if (is_permanente !== undefined) where.is_permanente = is_permanente === 'true';

    const estoque = await prisma.itens.findMany({
      where,
      include: { unidades_organizacionais: { select: { nome: true } } },
      orderBy: { quantidade: 'asc' } 
    });

    res.json(estoque);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar relatório de estoque.' });
  }
};

// 4. Histórico Completo de Patrimônio
export const getHistoricoPatrimonio = async (req: Request, res: Response) => {
  try {
    const historico = await prisma.movimentacaoBem.findMany({
      include: {
        bem: { select: { tombamento: true, descricao: true } },
        unidade_origem: { select: { nome: true } },
        unidade_destino: { select: { nome: true } }
      },
      orderBy: { data_envio: 'desc' }
    });

    res.json(historico);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar histórico de patrimônio.' });
  }
};



// 2. NOVO MÓDULO: DASHBOARD EXECUTIVO DE PRODUÇÃO E FINANÇAS


export const getDashboardProducao = async (req: Request, res: Response) => {
  try {
    const { dataInicial, dataFinal } = req.query;

    let onde: any = {};
    if (dataInicial && dataFinal) {
      onde.data_registro = {
        gte: new Date(`${dataInicial}T00:00:00.000Z`), 
        lte: new Date(`${dataFinal}T23:59:59.999Z`),   
      };
    }

    const producoes = await prisma.producaoServico.findMany({
      where: onde,
      include: {
        tecnico: { select: { nome_completo: true } },
        servico: { select: { nome_servico: true, categoria: true } },
      },
      orderBy: { data_registro: 'asc' }
    });

    let totalMaoObra = 0;
    let totalPecas = 0;
    let economiaTotal = 0;

    const mapTecnicos = new Map<number, { nome: string; qtd: number; valor: number }>();
    const mapServicos = new Map<number, { nome: string; qtd: number; valor: number }>();
    const mapEquipamentos = new Map<string, { qtd: number; custoTotal: number }>();
    const mapMeses = new Map<string, { maoObra: number; pecas: number; total: number }>();

    producoes.forEach(p => {
      const maoObra = Number(p.valor_servico_aplicado);
      const pecas = Number(p.valor_pecas_aplicado);
      const total = Number(p.valor_total_produzido);

      totalMaoObra += maoObra;
      totalPecas += pecas;
      economiaTotal += total;

      if (p.tecnico_id && p.tecnico) {
        const t = mapTecnicos.get(p.tecnico_id) || { nome: p.tecnico.nome_completo, qtd: 0, valor: 0 };
        t.qtd += 1;
        t.valor += total;
        mapTecnicos.set(p.tecnico_id, t);
      }

      if (p.servico_id && p.servico) {
        const s = mapServicos.get(p.servico_id) || { nome: p.servico.nome_servico, qtd: 0, valor: 0 };
        s.qtd += 1;
        s.valor += total;
        mapServicos.set(p.servico_id, s);
      }

      if (p.patrimonio_serie) {
        const eq = mapEquipamentos.get(p.patrimonio_serie) || { qtd: 0, custoTotal: 0 };
        eq.qtd += 1;
        eq.custoTotal += total;
        mapEquipamentos.set(p.patrimonio_serie, eq);
      }

      const data = new Date(p.data_registro);
      const mesAno = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}`;
      const m = mapMeses.get(mesAno) || { maoObra: 0, pecas: 0, total: 0 };
      m.maoObra += maoObra;
      m.pecas += pecas;
      m.total += total;
      mapMeses.set(mesAno, m);
    });
    
    const rankingTecnicos = Array.from(mapTecnicos.values()).sort((a, b) => b.valor - a.valor);
    const topServicos = Array.from(mapServicos.values()).sort((a, b) => b.qtd - a.qtd).slice(0, 5);
    const reincidenciaEquipamentos = Array.from(mapEquipamentos.entries())
      .map(([patrimonio, dados]) => ({ patrimonio, ...dados }))
      .sort((a, b) => b.qtd - a.qtd).slice(0, 10); // Top 10 mais problemáticos
    const evolucaoMensal = Array.from(mapMeses.entries())
      .map(([mes, dados]) => ({ mes, ...dados })).sort((a, b) => a.mes.localeCompare(b.mes));

    return res.json({
      resumoFinanceiro: { totalMaoObra, totalPecas, economiaTotal },
      rankingTecnicos,
      topServicos,
      reincidenciaEquipamentos,
      evolucaoMensal,
      totalServicosExecutados: producoes.length
    });

  } catch (error) {
    console.error("Erro ao processar relatórios de produção:", error);
    res.status(500).json({ message: "Erro interno ao processar os dados do relatório." });
  }
};