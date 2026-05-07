// src/routes/notificacaoRoutes.ts
import { Router } from 'express';
import { getMinhasNotificacoes, marcarComoLida } from '../controllers/notificacaoController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Protege com JWT
router.use(authMiddleware);

// GET /api/notificacoes
router.get('/', getMinhasNotificacoes);

// PATCH /api/notificacoes/:id/lida
router.patch('/:id/lida', marcarComoLida);

export default router;