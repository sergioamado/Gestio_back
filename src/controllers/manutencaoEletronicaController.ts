// src/controllers/manutencaoEletronicaController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { dispararNotificacao } from './notificacaoController';

const prisma = new PrismaClient();

const manutencaoSchema = z.object({
  glpi: z.string().optional(),
  tecnico_responsavel_id: z.number().int().optional(), // Tornado opcional, pois o criador pode não saber quem vai assumir
  equipamento: z.string().min(1, "O nome do equipamento é obrigatório."),
  descricao_problema: z.string().min(1, "A descrição do problema é obrigatória."),
});

export const createManutencao = async (req: Request, res: Response) => {
  try {
    const data = manutencaoSchema.parse(req.body);
    const usuarioLogadoId = req.user!.id; // Pega o ID de quem está criando o chamado
    
    // 🚀 Eletrônica #7: Grava quem abriu o chamado
    const payloadParaBanco: any = {
      ...data,
      aberto_por_id: usuarioLogadoId
    };

    // Se o frontend enviar um tecnico_responsavel_id inválido ou vazio, cai para o admin padrão (ou para ninguém)
    if (!data.tecnico_responsavel_id) {
       payloadParaBanco.tecnico_responsavel_id = usuarioLogadoId; // Atribui temporariamente a quem abriu
    }

    const novaManutencao = await prisma.manutencao_eletronica.create({ 
      data: payloadParaBanco 
    });

    if (novaManutencao.tecnico_responsavel_id !== usuarioLogadoId) {
      await dispararNotificacao({
        usuario_id: novaManutencao.tecnico_responsavel_id,
        titulo: '🔧 Novo Equipamento na Bancada',
        mensagem: `O equipamento *${novaManutencao.equipamento}* foi-lhe atribuído para reparo.\n\n⚠️ Problema relatado: ${novaManutencao.descricao_problema}`,
        tipo: 'alerta',
        link_acao: '/fila-manutencao-eletronica'
      });
    }

    res.status(201).json(novaManutencao);
  } catch (error) {
    console.error("Erro ao criar manutenção:", error); 
    res.status(400).json({ message: 'Dados inválidos.', details: error });
  }
};

export const getAllManutencoes = async (req: Request, res: Response) => {
  try {
    const manutencoes = await prisma.manutencao_eletronica.findMany({
      orderBy: { data_entrada: 'desc' }, // Alterado para 'desc' para vir o mais novo primeiro (Eletrônica #6 - Reforço no Back)
      include: {
        usuarios: {
          select: { nome_completo: true },
        },
        // 🚀 Eletrônica #7: Retorna os dados de quem abriu o chamado para a UI
        aberto_por: {
          select: { nome_completo: true }
        }
      },
    });
    res.json(manutencoes);
  } catch (error) {
    console.error("Erro ao buscar a fila de manutenção:", error);
    res.status(500).json({ message: 'Erro ao buscar a fila de manutenção.' });
  }
};

export const updateStatusManutencao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const idUsuarioAcao = req.user!.id;

  if (!status || !['Pendente', 'Em_manutencao', 'Concluido'].includes(status)) {
    return res.status(400).json({ message: 'Status inválido.' });
  }

  try {
    const manutencaoDb = await prisma.manutencao_eletronica.findUnique({ where: { id: Number(id) }});
    const manutencao = await prisma.manutencao_eletronica.update({
      where: { id: Number(id) },
      data: { status },
    });
    
    // Se o técnico da bancada não for quem mudou o status, ou se foi quem abriu, notifica os envolvidos
    if (manutencaoDb && manutencaoDb.tecnico_responsavel_id !== idUsuarioAcao) {
      await dispararNotificacao({
        usuario_id: manutencaoDb.tecnico_responsavel_id,
        titulo: '🔄 Status de Bancada Alterado',
        mensagem: `O status do equipamento *${manutencaoDb.equipamento}* foi alterado para: *${status}*.`,
        tipo: status === 'Concluido' ? 'sucesso' : 'info',
        link_acao: '/fila-manutencao-eletronica'
      });
    }

    if (manutencaoDb && manutencaoDb.aberto_por_id && manutencaoDb.aberto_por_id !== idUsuarioAcao) {
        await dispararNotificacao({
          usuario_id: manutencaoDb.aberto_por_id,
          titulo: '🔄 Status de Bancada Alterado',
          mensagem: `A manutenção do seu equipamento *${manutencaoDb.equipamento}* mudou para: *${status}*.`,
          tipo: status === 'Concluido' ? 'sucesso' : 'info',
          link_acao: '/fila-manutencao-eletronica'
        });
    }

    res.json(manutencao);
  } catch (error) {
    console.error("Erro ao atualizar status de manutenção:", error); 
    res.status(500).json({ message: 'Erro ao atualizar o status.' });
  }
};

export const iniciarManutencao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const tecnicoId = req.user!.id; 

  try {
    const manutencaoDb = await prisma.manutencao_eletronica.findUnique({ where: { id: Number(id) }});
    
    const manutencao = await prisma.manutencao_eletronica.update({
      where: { id: Number(id) },
      data: { 
        tecnico_responsavel_id: tecnicoId,
        status: 'Em_manutencao' 
      },
    });

    // Avisa quem abriu o chamado que o técnico começou a mexer
    if (manutencaoDb?.aberto_por_id) {
        await dispararNotificacao({
          usuario_id: manutencaoDb.aberto_por_id,
          titulo: '🛠️ Equipamento em Bancada',
          mensagem: `O técnico assumiu o reparo do seu equipamento *${manutencaoDb.equipamento}*.`,
          tipo: 'info',
          link_acao: '/fila-manutencao-eletronica'
        });
    }

    res.json(manutencao);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao iniciar manutenção.' });
  }
};

export const finalizarManutencao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { laudo_tecnico } = req.body;

  if (!laudo_tecnico) {
    return res.status(400).json({ message: 'O parecer técnico é obrigatório.' });
  }

  try {
    const manutencao = await prisma.manutencao_eletronica.update({
      where: { id: Number(id) },
      data: { 
        laudo_tecnico,
        status: 'Concluido' 
      },
      include: { usuarios: { select: { nome_completo: true } } }
    });
    
    // Avisa o gerente e quem abriu o chamado
    const gerentes = await prisma.usuarios.findMany({
      where: { role: 'gerente' }
    });

    for (const gerente of gerentes) {
      await dispararNotificacao({
        usuario_id: gerente.id,
        titulo: '✅ Equipamento Reparado',
        mensagem: `O técnico *${manutencao.usuarios?.nome_completo}* concluiu o reparo do equipamento *${manutencao.equipamento}*.\n\n📝 Parecer Técnico: ${laudo_tecnico}`,
        tipo: 'sucesso',
        link_acao: '/fila-manutencao-eletronica'
      });
    }

    if (manutencao.aberto_por_id) {
        await dispararNotificacao({
          usuario_id: manutencao.aberto_por_id,
          titulo: '✅ O Seu Equipamento Foi Reparado',
          mensagem: `O conserto do equipamento *${manutencao.equipamento}* foi finalizado.\n\n📝 Parecer Técnico: ${laudo_tecnico}`,
          tipo: 'sucesso',
          link_acao: '/fila-manutencao-eletronica'
        });
    }

    res.json(manutencao);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao finalizar manutenção.' });
  }
};

export const editarManutencao = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { equipamento, descricao_problema, laudo_tecnico } = req.body;
  const idUsuarioAcao = req.user!.id; 

  try {
    const [usuarioAcao, manutencaoAtual] = await Promise.all([
      prisma.usuarios.findUnique({ where: { id: idUsuarioAcao } }),
      prisma.manutencao_eletronica.findUnique({ where: { id: Number(id) } })
    ]);

    if (!manutencaoAtual) {
      return res.status(404).json({ message: 'Manutenção não encontrada.' });
    }

    let novaDescricao = descricao_problema;
    if (descricao_problema && descricao_problema !== manutencaoAtual.descricao_problema) {
        novaDescricao = `${descricao_problema}\n\n[✏️ Editado por ${usuarioAcao?.nome_completo} em ${new Date().toLocaleString('pt-BR')}]`;
    }

    let novoLaudo = laudo_tecnico;
    if (laudo_tecnico && laudo_tecnico !== manutencaoAtual.laudo_tecnico) {
        novoLaudo = `${laudo_tecnico}\n\n[✏️ Editado por ${usuarioAcao?.nome_completo} em ${new Date().toLocaleString('pt-BR')}]`;
    }

    const manutencao = await prisma.manutencao_eletronica.update({
      where: { id: Number(id) },
      data: { 
        equipamento,
        descricao_problema: novaDescricao,
        laudo_tecnico: novoLaudo
       },
    });

    if (manutencao.tecnico_responsavel_id !== idUsuarioAcao) {
      await dispararNotificacao({
        usuario_id: manutencao.tecnico_responsavel_id,
        titulo: '📝 Manutenção Editada',
        mensagem: `Os detalhes da manutenção do equipamento *${manutencao.equipamento}* foram atualizados por ${usuarioAcao?.nome_completo}.`,
        tipo: 'info',
        link_acao: '/fila-manutencao-eletronica'
      });
    }

    res.json(manutencao);
  } catch (error) {
    console.error("Erro ao editar manutenção:", error);
    res.status(500).json({ message: 'Erro ao editar manutenção.' });
  }
};