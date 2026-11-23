// src/controllers/solicitacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient, Prisma } from '@prisma/client';
import { z } from 'zod';
import { dispararNotificacao } from './notificacaoController';
import { getIO } from '../socket';
import {
  ITEM, OS, efeitoCancelamento, osEncerrada, papelDoAtor, podeConverterTeste, podeMudarStatusOS, transicaoItem,
  type Ator, type EfeitoEstoque,
} from '../rules/solicitacaoRules';

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
        // Desconta do estoque só se houver saldo: a checagem e o desconto são uma única
        // operação atômica, então pedidos simultâneos não deixam o estoque negativo.
        const campo = isTeste ? 'quantidade_teste' : 'quantidade_estoque';
        const { count } = await tx.itens.updateMany({
          where: { id: item.id, [campo]: { gte: item.quantidade } },
          data: { [campo]: { decrement: item.quantidade } },
        });
        if (count === 0) {
          const itemDb = await tx.itens.findUnique({ where: { id: item.id }, select: { descricao: true } });
          if (!itemDb) throw new Error(`Item não encontrado: ${item.id}`);
          throw new Error(`Estoque de ${isTeste ? 'TESTE' : 'CONSUMO'} insuficiente para: ${itemDb.descricao}`);
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


// Notifica os gerentes da unidade da OS (exceto quem fez a ação).
const notificarGerentesDaUnidade = async (
  unidadeId: number | null,
  excetoId: number,
  titulo: string,
  mensagem: string,
) => {
  if (!unidadeId) return;
  const gerentes = await prisma.usuarios.findMany({
    where: { role: 'gerente', unidade_id: unidadeId },
    select: { id: true },
  });
  for (const g of gerentes) {
    if (g.id === excetoId) continue;
    await dispararNotificacao({ usuario_id: g.id, titulo, mensagem, tipo: 'info', link_acao: '/gerenciar-solicitacoes' });
  }
};

type Tx = Prisma.TransactionClient;

const aplicarEfeitoEstoque = async (tx: Tx, itemId: number, quantidade: number, efeito: EfeitoEstoque) => {
  const campo =
    efeito === 'estoque+' ? 'quantidade_estoque'
    : efeito === 'teste+' ? 'quantidade_teste'
    : efeito === 'defeito+' ? 'quantidade_defeito'
    : null;
  if (!campo) return;
  await tx.itens.update({ where: { id: itemId }, data: { [campo]: { increment: quantidade } } });
};

class RegraNegocioError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/**
 * Verifica se o usuário pode agir nesta OS:
 * - admin: só visualiza;
 * - gerente: só OS da própria unidade;
 * - técnico: só OS que ele abriu.
 */
const verificarPermissaoNaOS = (
  user: { id: number; role: string; unidade_id: number | null },
  os: { usuario_id: number; unidade_id: number },
): Ator => {
  const ator = papelDoAtor(user.role);
  if (ator === 'admin') throw new RegraNegocioError(403, 'O administrador tem acesso somente de visualização às Ordens de Serviço.');
  if (ator === 'gerente' && os.unidade_id !== user.unidade_id) {
    throw new RegraNegocioError(403, 'Você só pode gerir Ordens de Serviço da sua unidade.');
  }
  if (ator === 'tecnico' && os.usuario_id !== user.id) {
    throw new RegraNegocioError(403, 'Você só pode agir nas Ordens de Serviço que abriu.');
  }
  if (ator === 'outro') throw new RegraNegocioError(403, 'Acesso negado.');
  return ator;
};

const textoCurtoOpcional = z.string().trim().max(100).nullable().optional();

const itemEntregaSchema = z.object({
  solicitacao_item_id: z.number().int(),
  status_entrega: z.string().optional(),
  motivo: z.string().trim().max(500).optional(),
  // Dados do SIPAC por peça (só o gerente edita)
  numero_pedido_sipac: textoCurtoOpcional,
  almoxarifado: textoCurtoOpcional,
});

const vazioParaNull = (v: string | null | undefined) => (v === undefined ? undefined : v && v.trim() ? v.trim() : null);

const updateSolicitacaoSchema = z.object({
  status: z.string().optional(),
  justificativa: z.string().nullable().optional(),
  itens_entrega: z.array(itemEntregaSchema).optional(),
});

export const updateSolicitacao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const user = req.user!;

  try {
    const body = updateSolicitacaoSchema.parse(req.body);

    const solicitacaoAtual = await prisma.solicitacoes.findUnique({
      where: { id: Number(id) },
      include: { solicitacao_itens: { include: { itens: { select: { descricao: true } } } } },
    });
    if (!solicitacaoAtual) return res.status(404).json({ message: 'OS não encontrada.' });

    const ator = verificarPermissaoNaOS(user, solicitacaoAtual);

    if (osEncerrada(solicitacaoAtual.status)) {
      throw new RegraNegocioError(400, 'Esta OS já está encerrada e não pode ser alterada.');
    }

    // Técnico não edita dados administrativos da OS.
    const enviouDadosSipac = (body.itens_entrega ?? []).some(
      (p) => p.numero_pedido_sipac !== undefined || p.almoxarifado !== undefined,
    );
    if (ator === 'tecnico' && (enviouDadosSipac || body.justificativa !== undefined)) {
      throw new RegraNegocioError(403, 'Somente o gerente pode alterar o pedido SIPAC, o almoxarifado e o histórico da OS.');
    }

    // ---- Status da OS ----
    const mudouStatus = body.status !== undefined && body.status !== solicitacaoAtual.status;
    if (mudouStatus && !podeMudarStatusOS(ator, solicitacaoAtual.status, body.status!)) {
      throw new RegraNegocioError(
        400,
        `Transição não permitida: "${solicitacaoAtual.status}" → "${body.status}" para o perfil ${ator}.`,
      );
    }

    // ---- Peças: valida tudo antes de gravar qualquer coisa ----
    const mudancasItens: Array<{
      item: (typeof solicitacaoAtual.solicitacao_itens)[number];
      statusFinal: string;
      efeito: EfeitoEstoque;
      motivo?: string;
    }> = [];

    const mudancasSipac: Array<{
      item: (typeof solicitacaoAtual.solicitacao_itens)[number];
      numero_pedido_sipac: string | null;
      almoxarifado: string | null;
    }> = [];

    for (const pedido of body.itens_entrega ?? []) {
      const item = solicitacaoAtual.solicitacao_itens.find((i) => i.id === pedido.solicitacao_item_id);
      if (!item) throw new RegraNegocioError(400, `A peça ${pedido.solicitacao_item_id} não pertence a esta OS.`);

      // Pedido SIPAC / almoxarifado da peça
      const numero = vazioParaNull(pedido.numero_pedido_sipac);
      const almox = vazioParaNull(pedido.almoxarifado);
      const novoNumero = numero !== undefined ? numero : item.numero_pedido_sipac;
      const novoAlmox = almox !== undefined ? almox : item.almoxarifado;
      if (novoNumero !== item.numero_pedido_sipac || novoAlmox !== item.almoxarifado) {
        mudancasSipac.push({ item, numero_pedido_sipac: novoNumero, almoxarifado: novoAlmox });
      }

      if (pedido.status_entrega === undefined || item.status_entrega === pedido.status_entrega) continue; // sem mudança de status

      const transicao = transicaoItem(ator, item.tipo_uso, item.status_entrega, pedido.status_entrega);
      if (!transicao) {
        throw new RegraNegocioError(
          400,
          `Transição não permitida para a peça "${item.itens?.descricao}": "${item.status_entrega}" → "${pedido.status_entrega}".`,
        );
      }
      if (transicao.statusFinal === ITEM.DEVOLVIDA && !pedido.motivo) {
        throw new RegraNegocioError(400, 'Informe o motivo da devolução da peça.');
      }
      mudancasItens.push({ item, statusFinal: transicao.statusFinal, efeito: transicao.efeito, motivo: pedido.motivo });
    }

    // Regra: para concluir, TODAS as peças (exceto canceladas) precisam ter Nº do pedido SIPAC e almoxarifado.
    if (mudouStatus && body.status === OS.CONCLUIDA) {
      const pendentes = solicitacaoAtual.solicitacao_itens.filter((item) => {
        const statusFinal = mudancasItens.find((m) => m.item.id === item.id)?.statusFinal ?? item.status_entrega;
        if (statusFinal === ITEM.CANCELADO) return false;
        const sipac = mudancasSipac.find((m) => m.item.id === item.id) ?? item;
        return !sipac.numero_pedido_sipac || !sipac.almoxarifado;
      });
      if (pendentes.length) {
        return res.status(400).json({
          bloqueio_regra: true,
          message: `⛔ Para concluir, todas as peças precisam ter o Nº do pedido SIPAC e o almoxarifado. Falta em: ${pendentes
            .map((i) => i.itens?.descricao)
            .join(', ')}.`,
        });
      }
    }

    // Histórico automático (data/hora gerada no servidor).
    const agora = new Date().toLocaleString('pt-BR');
    const linhasHistorico = [
      ...mudancasItens
        .filter((m) => m.motivo)
        .map((m) => `[${agora}] Peça "${m.item.itens?.descricao}" devolvida pelo técnico. Motivo: ${m.motivo}`),
      ...mudancasSipac.map(
        (m) =>
          `[${agora}] Peça "${m.item.itens?.descricao}": pedido SIPAC ${m.numero_pedido_sipac || '—'} / almoxarifado ${m.almoxarifado || '—'}.`,
      ),
    ];
    const justificativaBase = body.justificativa !== undefined ? body.justificativa : solicitacaoAtual.justificativa;
    const justificativaFinal = linhasHistorico.length
      ? `${justificativaBase || ''}\n${linhasHistorico.join('\n')}`.trim()
      : justificativaBase;

    let pecasDevolvidas = 0;
    const resultado = await prisma.$transaction(async (tx) => {
      const osAtualizada = await tx.solicitacoes.update({
        where: { id: Number(id) },
        data: {
          status: mudouStatus ? body.status : undefined,
          justificativa: justificativaFinal,
        },
      });

      for (const m of mudancasSipac) {
        await tx.solicitacao_itens.update({
          where: { id: m.item.id },
          data: { numero_pedido_sipac: m.numero_pedido_sipac, almoxarifado: m.almoxarifado },
        });
      }

      for (const m of mudancasItens) {
        // Atualização condicional: se outra requisição mudou a peça no meio do caminho, aborta.
        const { count } = await tx.solicitacao_itens.updateMany({
          where: { id: m.item.id, status_entrega: m.item.status_entrega },
          data: { status_entrega: m.statusFinal, data_entrega: m.statusFinal === ITEM.ENTREGUE ? new Date() : undefined },
        });
        if (count === 0) throw new RegraNegocioError(409, 'A OS foi alterada por outra pessoa. Recarregue a página e tente de novo.');

        await aplicarEfeitoEstoque(tx, m.item.item_id, m.item.quantidade_solicitada, m.efeito);
      }

      // OS cancelada: as peças voltam ao estoque correspondente (teste ou consumo).
      if (mudouStatus && body.status === OS.CANCELADA) {
        for (const item of solicitacaoAtual.solicitacao_itens) {
          const statusAtual = mudancasItens.find((m) => m.item.id === item.id)?.statusFinal ?? item.status_entrega;
          const efeito = efeitoCancelamento(item.tipo_uso, statusAtual);
          if (efeito === null) continue;

          const { count } = await tx.solicitacao_itens.updateMany({
            where: { id: item.id, status_entrega: statusAtual },
            data: { status_entrega: ITEM.CANCELADO },
          });
          if (count === 0) throw new RegraNegocioError(409, 'A OS foi alterada por outra pessoa. Recarregue a página e tente de novo.');
          await aplicarEfeitoEstoque(tx, item.item_id, item.quantidade_solicitada, efeito);
          pecasDevolvidas++;
        }
      }
      return osAtualizada;
    });

    // ---- Notificações ----
    const glpi = solicitacaoAtual.numero_glpi;
    if (ator === 'gerente') {
      const partes: string[] = [];
      if (mudouStatus) partes.push(`Status da OS: *${body.status}*.`);
      if (pecasDevolvidas) partes.push(`${pecasDevolvidas} peça(s) devolvida(s) ao estoque.`);
      for (const m of mudancasItens) partes.push(`Peça *${m.item.itens?.descricao}*: ${m.statusFinal}.`);
      if (partes.length && solicitacaoAtual.usuario_id !== user.id) {
        await dispararNotificacao({
          usuario_id: solicitacaoAtual.usuario_id,
          titulo: '🔄 Atualização na sua OS',
          mensagem: `OS (GLPI: ${glpi})\n${partes.join('\n')}`,
          tipo: body.status === OS.CANCELADA ? 'alerta' : 'info',
          link_acao: '/gerenciar-solicitacoes',
        });
      }
    } else {
      const partes: string[] = [];
      if (mudouStatus) partes.push('A OS está *pronta para vistoria*.');
      for (const m of mudancasItens) {
        partes.push(
          m.statusFinal === ITEM.DEVOLVIDA
            ? `Peça *${m.item.itens?.descricao}* devolvida com defeito: ${m.motivo}.`
            : `Peça *${m.item.itens?.descricao}* recebida pelo técnico.`,
        );
      }
      if (partes.length) {
        await notificarGerentesDaUnidade(solicitacaoAtual.unidade_id, user.id, '🧑‍🔧 Ação do técnico na OS', `OS (GLPI: ${glpi})\n${partes.join('\n')}`);
      }
    }

    try { getIO().emit('atualizar_tabelas_os'); } catch (e) {}
    try { getIO().emit('atualizar_estoque'); } catch (e) {}
    res.status(200).json(resultado);
  } catch (error) {
    if (error instanceof RegraNegocioError) return res.status(error.status).json({ message: error.message });
    if (error instanceof z.ZodError) return res.status(400).json({ message: 'Dados inválidos.', details: error.issues });
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

export const converterTesteEmConsumo = async (req: Request, res: Response) => {
  const { itemId } = req.params;
  const user = req.user!;

  try {
    const itemAtual = await prisma.solicitacao_itens.findUnique({
      where: { id: Number(itemId) },
      include: { solicitacoes: { include: { solicitacao_itens: true } }, itens: true },
    });

    if (!itemAtual) return res.status(404).json({ message: "Item não encontrado." });

    const ator = verificarPermissaoNaOS(user, itemAtual.solicitacoes);
    if (ator !== 'tecnico') throw new RegraNegocioError(403, 'Somente o técnico da OS pode pedir a peça definitiva.');
    if (osEncerrada(itemAtual.solicitacoes.status)) throw new RegraNegocioError(400, 'Esta OS já está encerrada.');
    if (!podeConverterTeste(itemAtual.tipo_uso, itemAtual.status_entrega)) {
      throw new RegraNegocioError(400, 'Só é possível pedir a definitiva de uma peça de teste que está com o técnico.');
    }
    // Evita pedir a mesma definitiva duas vezes.
    const jaPediu = itemAtual.solicitacoes.solicitacao_itens.some(
      (i) => i.item_id === itemAtual.item_id && i.tipo_uso === 'CONSUMO' && i.id !== itemAtual.id,
    );
    if (jaPediu) throw new RegraNegocioError(409, 'A peça definitiva já foi solicitada nesta OS.');

    const resultado = await prisma.$transaction(async (tx) => {
      // Desconta do estoque de consumo só se houver saldo (atômico: evita estoque negativo).
      const { count } = await tx.itens.updateMany({
        where: { id: itemAtual.item_id, quantidade_estoque: { gte: itemAtual.quantidade_solicitada } },
        data: { quantidade_estoque: { decrement: itemAtual.quantidade_solicitada } },
      });
      if (count === 0) {
        throw new RegraNegocioError(400, `Sem estoque de CONSUMO suficiente para a peça: ${itemAtual.itens.descricao}`);
      }

      // A peça de teste continua aguardando devolução ao almoxarifado.
      await tx.solicitacao_itens.update({
        where: { id: Number(itemId) },
        data: { status_entrega: ITEM.AGUARDANDO_DEVOLUCAO },
      });

      const novoItemConsumo = await tx.solicitacao_itens.create({
        data: {
          solicitacao_id: itemAtual.solicitacao_id,
          item_id: itemAtual.item_id,
          quantidade_solicitada: itemAtual.quantidade_solicitada,
          tipo_uso: 'CONSUMO',
          status_entrega: ITEM.PENDENTE,
        },
      });

      const novaJustificativa = `${itemAtual.solicitacoes.justificativa || ''}\n[${new Date().toLocaleString('pt-BR')}] Peça de teste "${itemAtual.itens.descricao}" funcionou. Solicitada a peça definitiva de consumo. Aguardando troca.`.trim();
      await tx.solicitacoes.update({
        where: { id: itemAtual.solicitacao_id },
        data: { justificativa: novaJustificativa },
      });

      return novoItemConsumo;
    });

    await notificarGerentesDaUnidade(
      itemAtual.solicitacoes.unidade_id,
      user.id,
      '🔄 Peça de Consumo Solicitada',
      `O técnico confirmou o teste da peça ${itemAtual.itens.descricao} na OS ${itemAtual.solicitacoes.numero_glpi}. A peça de teste será devolvida e a definitiva precisa ser separada.`,
    );
    try { getIO().emit('atualizar_tabelas_os'); } catch (e) {}
    try { getIO().emit('atualizar_estoque'); } catch (e) {}
    return res.status(200).json({ message: "Conversão realizada com sucesso!", data: resultado });
  } catch (error: any) {
    if (error instanceof RegraNegocioError) return res.status(error.status).json({ message: error.message });
    console.error(error);
    return res.status(500).json({ message: "Erro ao converter item de teste em consumo." });
  }
};
