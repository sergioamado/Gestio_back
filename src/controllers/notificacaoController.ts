// src/controllers/notificacaoController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import { getIO } from '../socket';
import crypto from 'crypto';

//  CARREGAMENTO DE VARIÁVEIS DE AMBIENTE E BANCO DE DADOS
dotenv.config();
const prisma = new PrismaClient();


// INICIALIZAÇÃO DO BOT DO TELEGRAM
// Pegamos a chave (token) do Telegram que está no arquivo .env
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
    
    // Erro 502 = Telegram em manutenção: passageiro, ignoramos.
    if (error?.response?.statusCode === 502) {
        return;
    }
    // Erros do próprio Telegram NÃO são silenciados: indicam problema real.
    //   401 = token inválido · 409 = outro servidor (ou webhook) usando o mesmo bot.
    if (error.code === 'ETELEGRAM') {
        const status = error?.response?.statusCode;
        const dica = status === 409
          ? ' → Há outra instância do backend (ou um webhook) usando este bot. Deixe só um servidor rodando.'
          : status === 401 ? ' → TELEGRAM_BOT_TOKEN inválido no .env.' : '';
        console.error(`[Telegram] Erro do Telegram (${status ?? '?'}): ${msgErro}${dica}`);
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
          // Um mesmo Telegram só pode estar ligado a um usuário: se já estava em outro, passa para este.
          await prisma.$transaction([
            prisma.usuarios.updateMany({
              where: { telegram_chat_id: chatId, NOT: { id: usuario.id } },
              data: { telegram_chat_id: null },
            }),
            // Grava o chat e apaga o código para que não possa ser usado outra vez.
            prisma.usuarios.update({
              where: { id: usuario.id },
              data: { telegram_chat_id: chatId, telegram_token: null, notificacoes_bot: true },
            }),
          ]);
          try { getIO().to(`user_${usuario.id}`).emit('telegram_vinculado'); } catch { /* socket opcional */ }
          
          // Envia a mensagem de boas-vindas diretamente para o celular do usuário
          bot.sendMessage(
            chatId, 
            `✅ *Bem-vindo(a), ${usuario.nome_completo}!* \n\nO seu Telegram foi vinculado com sucesso ao *COSUP+*. A partir de agora, os alertas de Ordens de Serviço e Estoque chegarão aqui. `, 
            { parse_mode: 'Markdown' } // Permite usar *negrito*
          );
        } else {
          // Se não encontrou o usuário, o link expirou ou foi inventado
          bot.sendMessage(chatId, '❌ Link inválido ou já utilizado. Gere um novo link no COSUP+ (sininho → Telegram).');
        }
      } catch (err) {
        console.error('Erro na conexão do bot:', err);
        bot.sendMessage(chatId, '⚠️ Erro interno ao vincular conta.');
      }
    }
  });

  // Qualquer mensagem que não seja o /start com código do link (ex.: "/start" puro ou "oi"):
  // responde com instruções e o Telegram ID da conversa — confirma que o bot está recebendo
  // e dá o número certo para quem preferir digitar o ID no sistema.
  bot.on('message', (msg) => {
    if (msg.text && /^\/start .+/.test(msg.text)) return; // tratado acima (vinculação pelo link)
    console.log(`[Telegram] Mensagem recebida (chat ${msg.chat.id}).`);
    bot.sendMessage(
      msg.chat.id,
      `👋 Olá! Sou o bot do COSUP+.\n\nSeu Telegram ID é: ${msg.chat.id}\n\nPara receber os alertas, abra o sistema → sininho → ⚙️ → "Gerar Link e Abrir Bot", ou digite este ID na Central de Preferências de Alertas.`,
    );
  });

  console.log('[Telegram] Bot ativo e aguardando mensagens.');
}

/**
 * Envia uma mensagem pelo bot. Tenta com formatação (Markdown); se o Telegram recusar
 * por causa de caracteres especiais no texto (ex.: "_" ou "*"), reenvia sem formatação.
 */
export const enviarTelegram = async (chatId: string, texto: string) => {
  if (!bot) return;
  try {
    await bot.sendMessage(chatId, texto, { parse_mode: 'Markdown' });
  } catch (err: any) {
    const descricao: string = err?.response?.body?.description || err?.message || '';
    if (/can't parse entities/i.test(descricao)) {
      await bot.sendMessage(chatId, texto.replace(/[*_`\[\]]/g, ''));
      return;
    }
    throw err;
  }
};


// MOTOR CENTRAL DE DISPARO DE NOTIFICAÇÕES (Usado por todo o Backend)



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

    // SININHO DO SISTEMA
    if (usuario.notificacoes_app) {
      //  Agora sim, guardamos a notificação criada numa variável
      const novaNotificacao = await prisma.notificacoes.create({
        data: {
          usuario_id: dados.usuario_id,
          titulo: dados.titulo,
          mensagem: dados.mensagem,
          tipo: dados.tipo.toUpperCase(), 
          link_acao: dados.link_acao,
          lida: false 
        }
      });

      //  O GRITO NO RÁDIO: Usamos 'dados.usuario_id' para achar a sala certa
      try {
        getIO().to(`user_${dados.usuario_id}`).emit('nova_notificacao', novaNotificacao);
      } catch (err) {
        console.error("Aviso: Rádio desligado ou erro ao emitir.", err);
      }
    }

    // MENSAGEM NO TELEGRAM
    if (bot && usuario.telegram_chat_id && usuario.notificacoes_bot) {
      const icones: Record<string, string> = { 'info': 'ℹ️', 'alerta': '⚠️', 'sucesso': '✅', 'erro': '❌' };
      const icone = icones[dados.tipo.toLowerCase()] || '🔔';
      const texto = `${icone} *${dados.titulo}*\n\n${dados.mensagem}${dados.link_acao ? `\n\n🔗 [Acessar no Sistema](${FRONTEND_URL}${dados.link_acao})` : ''}`;
      
      try {
        await enviarTelegram(usuario.telegram_chat_id, texto);
      } catch (err: any) {
        const status = err?.response?.statusCode;
        // 403 = o usuário bloqueou o bot ou apagou a conversa: desvincula para não tentar de novo.
        if (status === 403) {
          await prisma.usuarios.update({ where: { id: dados.usuario_id }, data: { telegram_chat_id: null } });
          console.warn(`[Telegram] Usuário ${dados.usuario_id} bloqueou o bot; Telegram desvinculado.`);
        } else {
          console.error(`[Telegram] Falha ao enviar para o usuário ${dados.usuario_id}:`, err?.response?.body?.description || err?.message);
        }
      }
    }
  } catch (error) {
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
    // Só marca se a notificação for do próprio usuário.
    const { count } = await prisma.notificacoes.updateMany({
      where: { id: Number(id), usuario_id: req.user!.id },
      data: { lida: true }
    });
    if (count === 0) return res.status(404).json({ message: 'Notificação não encontrada.' });
    res.json({ id: Number(id), lida: true });
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


//  Gera o Link do Telegram (Deep Linking)
export const gerarLinkTelegram = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id; 

  try {
    const tokenSecreto = crypto.randomBytes(8).toString('hex');

    await prisma.usuarios.update({
      where: { id: usuarioId },
      data: { telegram_token: tokenSecreto }
    });

    const botUsername = process.env.TELEGRAM_BOT_USERNAME;

    if (!botUsername) {
      return res.status(500).json({ message: 'A variável TELEGRAM_BOT_USERNAME não está configurada no servidor (.env).' });
    }

    const link = `https://t.me/${botUsername}?start=${tokenSecreto}`;

    res.json({ link });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao gerar link de vinculação do Telegram.' });
  }
};

//  Situação da vinculação (o front consulta ao abrir as telas e depois de gerar o link)
export const statusTelegram = async (req: Request, res: Response) => {
  const usuario = await prisma.usuarios.findUnique({
    where: { id: req.user!.id },
    select: { telegram_chat_id: true, notificacoes_bot: true, notificacoes_app: true },
  });
  const botUsername = (process.env.TELEGRAM_BOT_USERNAME || '').replace(/^@/, '') || null;
  res.json({
    bot_ativo: !!bot,
    bot_username: botUsername,
    bot_link: botUsername ? `https://t.me/${botUsername}` : null,
    vinculado: !!usuario?.telegram_chat_id,
    telegram_chat_id: usuario?.telegram_chat_id ?? null,
    notificacoes_bot: usuario?.notificacoes_bot ?? false,
    notificacoes_app: usuario?.notificacoes_app ?? true,
  });
};

//  Atualiza as preferências (Sininho e Telegram)
export const atualizarPreferenciasNotificacao = async (req: Request, res: Response) => {
  const usuarioId = req.user?.id;
  //  AGORA EXTRAIMOS O TELEGRAM_CHAT_ID TAMBÉM
  const { notificacoes_app, notificacoes_bot, desvincular_telegram, telegram_chat_id } = req.body;

  try {
    const dataAtualizacao: any = {
      notificacoes_app,
      notificacoes_bot
    };

    // ID digitado manualmente: só aceita se o bot conseguir mandar mensagem para ele
    // (o usuário precisa ter iniciado o bot). Evita IDs errados ou de outra pessoa.
    if (typeof telegram_chat_id === 'string' && telegram_chat_id.trim() && !desvincular_telegram) {
      const chatId = telegram_chat_id.trim();
      if (!/^-?\d{5,20}$/.test(chatId)) {
        return res.status(400).json({ message: 'O Telegram ID deve conter apenas números.' });
      }
      const atual = await prisma.usuarios.findUnique({ where: { id: usuarioId }, select: { telegram_chat_id: true } });
      if (atual?.telegram_chat_id !== chatId) {
        if (!bot) return res.status(503).json({ message: 'O bot do Telegram não está ativo no servidor.' });
        try {
          await enviarTelegram(chatId, '✅ Seu Telegram foi vinculado ao COSUP+.');
        } catch (err: any) {
          const descricao: string = err?.response?.body?.description || err?.message || 'erro desconhecido';
          console.warn(`[Telegram] ID manual recusado para o usuário ${usuarioId}: ${descricao}`);
          const bot_ = `@${process.env.TELEGRAM_BOT_USERNAME || 'bot'}`;
          let motivo = `O Telegram respondeu: "${descricao}".`;
          if (/chat not found/i.test(descricao)) {
            motivo = `O Telegram não encontrou uma conversa com este ID. Confira o número e abra o ${bot_} tocando em "Iniciar".`;
          } else if (/can't initiate conversation|have no rights to send/i.test(descricao)) {
            motivo = `Você ainda não iniciou o ${bot_}. Abra o bot no Telegram e toque em "Iniciar" (Start).`;
          } else if (/blocked by the user/i.test(descricao)) {
            motivo = `Você bloqueou o ${bot_}. Desbloqueie o bot no Telegram e tente de novo.`;
          } else if (/deactivated/i.test(descricao)) {
            motivo = 'Esta conta do Telegram foi desativada.';
          }
          return res.status(400).json({
            message: `${motivo} Dica: o jeito mais fácil é usar o botão "Gerar Link e Abrir Bot" (sininho → ⚙️).`,
          });
        }
        const dono = await prisma.usuarios.findFirst({ where: { telegram_chat_id: chatId, NOT: { id: usuarioId } }, select: { id: true } });
        if (dono) return res.status(409).json({ message: 'Este Telegram já está vinculado a outro usuário.' });
        dataAtualizacao.telegram_chat_id = chatId;
      }
    }

    if (desvincular_telegram === true) {
      dataAtualizacao.telegram_chat_id = null;
      dataAtualizacao.telegram_token = null;
      dataAtualizacao.notificacoes_bot = false;
    }

    const usuarioAtualizado = await prisma.usuarios.update({
      where: { id: usuarioId },
      data: dataAtualizacao,
      select: { notificacoes_app: true, notificacoes_bot: true, telegram_chat_id: true }
    });

    res.json({ 
      message: 'Preferências atualizadas com sucesso!', 
      vinculado: !!usuarioAtualizado.telegram_chat_id,
      preferencias: usuarioAtualizado
    });
  } catch (error) {
    res.status(500).json({ message: 'Erro ao atualizar preferências.' });
  }
};