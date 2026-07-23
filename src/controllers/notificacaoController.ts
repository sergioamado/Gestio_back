// src/controllers/notificacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

dotenv.config();
const prisma = new PrismaClient();

// INICIALIZAÇÃO DO BOT DO TELEGRAM
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
export const bot = telegramToken ? new TelegramBot(telegramToken, { polling: true }) : null;

// Lógica de Deep Linking (Conexão Silenciosa do Bot)
if (bot) {
  bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString();
    const tokenSecreto = match ? match[1] : null;

    if (tokenSecreto) {
      try {
        const usuario = await prisma.usuarios.findUnique({ where: { telegram_token: tokenSecreto } });
        
        if (usuario) {
          await prisma.usuarios.update({
            where: { id: usuario.id },
            data: { telegram_chat_id: chatId, telegram_token: null }
          });
          bot.sendMessage(chatId, `✅ *Bem-vindo(a), ${usuario.nome_completo}!* \nO seu Telegram foi vinculado com sucesso ao Gestio. Passará a receber alertas importantes aqui.`, { parse_mode: 'Markdown' });
        } else {
          bot.sendMessage(chatId, '❌ Link de conexão inválido ou já expirado.');
        }
      } catch (err) {
        console.error('Erro na conexão do bot:', err);
      }
    }
  });
}

// MOTOR CENTRAL DE NOTIFICAÇÕES 
export const dispararNotificacao = async (dados: {
  usuario_id: number;
  titulo: string;
  mensagem: string;
  tipo: string; 
  link_acao?: string;
}) => {
  try {
    const usuario = await prisma.usuarios.findUnique({
      where: { id: dados.usuario_id },
      select: { telegram_chat_id: true, notificacoes_app: true, notificacoes_bot: true }
    });

    if (!usuario) return;

    // Grava no Sininho Interno
    if (usuario.notificacoes_app) {
      await prisma.notificacoes.create({
        data: {
          usuario_id: dados.usuario_id,
          titulo: dados.titulo,
          mensagem: dados.mensagem,
          tipo: dados.tipo.toUpperCase(), 
          link_acao: dados.link_acao,
          lida: false
        }
      });
    }

    // Dispara o Push no Telegram
    if (bot && usuario.telegram_chat_id && usuario.notificacoes_bot) {
      const icones: Record<string, string> = { 'info': 'ℹ️', 'alerta': '⚠️', 'sucesso': '✅', 'erro': '❌' };
      const icone = icones[dados.tipo.toLowerCase()] || '🔔';

      const urlFrontend = 'http://localhost:5173';
      const texto = `${icone} *${dados.titulo}*\n\n${dados.mensagem}${dados.link_acao ? `\n\n🔗 [Acessar no Sistema](${urlFrontend}${dados.link_acao})` : ''}`;
      
      await bot.sendMessage(usuario.telegram_chat_id, texto, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    console.error(`Falha ao notificar user ${dados.usuario_id}:`, error);
  }
};

//  ENDPOINTS HTTP PARA O FRONTEND
export const getNotificacoes = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id;
    const notificacoes = await prisma.notificacoes.findMany({
      where: { usuario_id: usuarioId },
      orderBy: { data_criacao: 'desc' },
      take: 50 // Limita as últimas 50 para não pesar
    });
    res.json(notificacoes);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar notificações' });
  }
};

export const marcarComoLida = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const notificacao = await prisma.notificacoes.update({
      where: { id: Number(id) },
      data: { lida: true }
    });
    res.json(notificacao);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao marcar como lida' });
  }
};

export const marcarTodasComoLidas = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id;
    await prisma.notificacoes.updateMany({
      where: { usuario_id: usuarioId, lida: false },
      data: { lida: true }
    });
    res.json({ message: 'Todas as notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao marcar todas como lidas' });
  }
};