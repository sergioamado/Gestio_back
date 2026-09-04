// src/controllers/notificacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';

//  CARREGAMENTO DE VARIÁVEIS DE AMBIENTE E BANCO DE DADOS
dotenv.config();
const prisma = new PrismaClient();

// INICIALIZAÇÃO DO BOT DO TELEGRAM
// Pegamos a chave (token) do Telegram que está no ficheiro .env
const telegramToken = process.env.TELEGRAM_BOT_TOKEN;

// Se o token existir, ligamos o bot com { polling: true }. 
// O "polling" faz o bot perguntar ao Telegram a cada 1 segundo: "Alguém falou comigo?"
export const bot = telegramToken ? new TelegramBot(telegramToken, { polling: true }) : null;

// URL do Frontend (Usada para criar links clicáveis dentro das mensagens do Telegram)
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';


//  COMPORTAMENTOS DO BOT DO TELEGRAM (Se ele estiver ativo)

if (bot) {
  
  // 🛡️ SILENCIADOR DE ERROS DE REDE (A CORREÇÃO DO SPAM NO CONSOLE!)
  // Como o "polling" exige internet contínua, qualquer piscar de rede gera um erro.
  // Este bloco captura esses erros, esconde os que são irrelevantes (como o EFATAL) 
  // e impede que o servidor Node.js trave. O bot tenta reconectar sozinho logo a seguir.
  bot.on('polling_error', (error: any) => {
    const msgErro = error.message || '';
    
    // Se o erro contiver EFATAL, ETIMEDOUT ou ENOTFOUND, é só oscilação de internet. Ignoramos.
    if (msgErro.includes('EFATAL') || msgErro.includes('ETIMEDOUT') || msgErro.includes('ENOTFOUND')) {
        return; // Sai da função silenciosamente
    }
    
    // Se for erro 502 (o Telegram está em manutenção) ou erro ETELEGRAM, também ignoramos.
    if (error?.response?.statusCode === 502 || error.code === 'ETELEGRAM') {
        return; 
    }

    // Só mostra no console se for um erro realmente estranho e diferente dos de rede
    console.error('[Telegram] Aviso de rede (bot reconectando):', error.message);
  });

  // 🔗 LÓGICA DE CONEXÃO (DEEP LINKING) - QUANDO O USUÁRIO CLICA NO LINK PARA ATIVAR O BOT
  // Quando o usuário clica num link do tipo: t.me/SeuBot?start=TOKEN_SECRETO
  // O Telegram envia a mensagem "/start TOKEN_SECRETO". Esta função "escuta" essa mensagem.
  bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id.toString(); // ID da conversa do usuário com o Bot
    const tokenSecreto = match ? match[1] : null; // Pega só a parte do token

    if (tokenSecreto) {
      try {
        // Vai ao banco de dados procurar quem é o usuário dono deste token
        const usuario = await prisma.usuarios.findUnique({ where: { telegram_token: tokenSecreto } });
        
        if (usuario) {
          // Se encontrou, atualiza o usuário gravando o "chatId" (o "número de telefone" do Telegram)
          // E apaga o token para que não possa ser usado outra vez por segurança.
          await prisma.usuarios.update({
            where: { id: usuario.id },
            data: { telegram_chat_id: chatId, telegram_token: null }
          });
          
          // Envia a mensagem de boas-vindas diretamente para o celular do usuário
          bot.sendMessage(
            chatId, 
            `✅ *Bem-vindo(a), ${usuario.nome_completo}!* \n\nO seu Telegram foi vinculado com sucesso ao *Gestio*. A partir de agora, os alertas de Ordens de Serviço e Estoque chegarão aqui. 🚀`, 
            { parse_mode: 'Markdown' } // Permite usar *negrito*
          );
        } else {
          // Se não encontrou o usuário, o link expirou ou foi inventado
          bot.sendMessage(chatId, '❌ Link inválido. Gere um novo link no painel do Gestio.');
        }
      } catch (err) {
        console.error('Erro na conexão do bot:', err);
        bot.sendMessage(chatId, '⚠️ Erro interno ao vincular conta.');
      }
    }
  });
}


// MOTOR CENTRAL DE DISPARO DE NOTIFICAÇÕES (Usado por todo o Backend)

// Qualquer controller (ex: solicitacaoController) chama esta função para avisar alguém.
export const dispararNotificacao = async (dados: {
  usuario_id: number;
  titulo: string;
  mensagem: string;
  tipo: string; 
  link_acao?: string;
}) => {
  try {
    // Descobrimos as preferências do usuário que vai receber o aviso
    const usuario = await prisma.usuarios.findUnique({
      where: { id: dados.usuario_id },
      select: { telegram_chat_id: true, notificacoes_app: true, notificacoes_bot: true }
    });

    if (!usuario) return; // Se o usuário não existir, não faz nada.

    // SININHO DO SISTEMA (NOTIFICAÇÃO INTERNA)
    // Se ele ativou alertas dentro do sistema (o sininho no canto superior da tela)
    if (usuario.notificacoes_app) {
      await prisma.notificacoes.create({
        data: {
          usuario_id: dados.usuario_id,
          titulo: dados.titulo,
          mensagem: dados.mensagem,
          tipo: dados.tipo.toUpperCase(), 
          link_acao: dados.link_acao,
          lida: false // Nasce como "Não Lida" para acender a bolinha vermelha
        }
      });
    }

    //  MENSAGEM NO TELEGRAM (PUSH EXTERNO)
    // Se o bot estiver ativo, o usuário tiver um chat vinculado e aceitar receber alertas no celular
    if (bot && usuario.telegram_chat_id && usuario.notificacoes_bot) {
      
      // Escolhe um emoji bonito baseado no tipo da notificação (info, alerta, sucesso, erro)
      const icones: Record<string, string> = { 'info': 'ℹ️', 'alerta': '⚠️', 'sucesso': '✅', 'erro': '❌' };
      const icone = icones[dados.tipo.toLowerCase()] || '🔔';

      // Monta o texto. Se houver link, cria um botão clicável com o FRONTEND_URL.
      const texto = `${icone} *${dados.titulo}*\n\n${dados.mensagem}${dados.link_acao ? `\n\n🔗 [Acessar no Sistema](${FRONTEND_URL}${dados.link_acao})` : ''}`;
      
      // Dispara a mensagem para o telemóvel do usuário!
      await bot.sendMessage(usuario.telegram_chat_id, texto, { parse_mode: 'Markdown' });
    }
  } catch (error) {
    // Se falhar o envio (ex: usuário bloqueou o bot), apenas regista no console do servidor
    console.error(`Falha ao notificar user ${dados.usuario_id}:`, error);
  }
};


// 📡 ENDPOINTS HTTP (O que o Frontend chama via axios/api)

// Busca a lista de notificações para preencher o "Sininho" do Frontend
export const getNotificacoes = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id; // Pega o ID de quem está logado
    const notificacoes = await prisma.notificacoes.findMany({
      where: { usuario_id: usuarioId },
      orderBy: { data_criacao: 'desc' }, // As mais recentes primeiro
      take: 50 // Limita para não travar o navegador se houver milhares
    });
    res.json(notificacoes);
  } catch (error) {
    res.status(500).json({ message: 'Erro ao buscar notificações' });
  }
};

// Quando o usuário clica numa notificação específica, esta rota marca-a como lida
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

// O botão "Marcar todas como lidas" no menu do sininho
export const marcarTodasComoLidas = async (req: Request, res: Response) => {
  try {
    const usuarioId = req.user!.id;
    await prisma.notificacoes.updateMany({
      where: { usuario_id: usuarioId, lida: false }, // Só atualiza as que estão não lidas
      data: { lida: true }
    });
    res.json({ message: 'Todas as notificações marcadas como lidas.' });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao marcar todas como lidas' });
  }
};