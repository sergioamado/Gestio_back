// src/controllers/notificacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// --- FUNÇÃO INTERNA DO CONTROLADOR ---
// Dispara a requisição HTTP para a API do Telegram
const enviarMensagemTelegram = async (chat_id: string, mensagem: string) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  
  if (!token || !chat_id) {
    console.warn("Telegram Token ou Chat ID não configurados. Notificação não enviada.");
    return;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chat_id,
        text: mensagem,
        parse_mode: 'HTML' 
      })
    });

    if (!response.ok) {
      console.error("Falha ao enviar mensagem via Telegram:", await response.text());
    }
  } catch (error) {
    console.error("Erro na comunicação com a API do Telegram:", error);
  }
};

// --- ROTAS DA API ---

// 1. Lista as notificações do usuário logado (Sininho do Front)
export const getMinhasNotificacoes = async (req: Request, res: Response) => {
  const usuario_id = req.user!.id;

  try {
    const notificacoes = await prisma.notificacoes.findMany({
      where: { usuario_id },
      orderBy: { data_criacao: 'desc' },
      take: 20 
    });
    res.json(notificacoes);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar notificações.' });
  }
};

// 2. Marca uma notificação como lida
export const marcarComoLida = async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const notificacao = await prisma.notificacoes.update({
      where: { id: Number(id) },
      data: { lida: true }
    });
    res.json(notificacao);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar notificação.' });
  }
};

// --- FUNÇÃO AUXILIAR PARA OUTROS CONTROLADORES ---
// Você vai importar e chamar esta função dentro do solicitacaoController, por exemplo.
export const criarNotificacaoInterna = async (usuario_id: number, mensagem: string, telegram_chat_id?: string) => {
  try {
    // Salva no banco de dados
    await prisma.notificacoes.create({
      data: {
        usuario_id,
        mensagem,
        lida: false,
        data_criacao: new Date()
      }
    });

    // Se o usuário tiver um ID do Telegram, dispara a mensagem
    if (telegram_chat_id) {
      await enviarMensagemTelegram(telegram_chat_id, `🔔 <b>Gestio Informa:</b>\n\n${mensagem}`);
    }
  } catch (error) {
    console.error('Erro ao processar notificação interna:', error);
  }
};