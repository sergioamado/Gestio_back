// src/routes/notificacaoRoutes.ts
import { Router } from 'express';
import { getNotificacoes, marcarComoLida, marcarTodasComoLidas } from '../controllers/notificacaoController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Protege todas as rotas de notificação com JWT
router.use(authMiddleware);

// GET /api/notificacoes - Lista as notificações do usuário
router.get('/', getNotificacoes);

// PUT /api/notificacoes/lidas-todas - Marca todas como lidas (IMPORTANTE: Fica acima da rota com :id)
router.put('/lidas-todas', marcarTodasComoLidas);

// PUT /api/notificacoes/:id/lida - Marca uma notificação específica como lida
router.put('/:id/lida', marcarComoLida);

export default router;