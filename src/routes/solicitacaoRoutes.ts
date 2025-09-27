// src/routes/solicitacaoRoutes.ts
import { Router } from 'express';
import { getAllSolicitacoes, createSolicitacao, getSolicitacaoById, updateStatusSolicitacao, getLatestSolicitacoes, updateSolicitacaoItemStatus } from '../controllers/solicitacaoController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Todas as rotas de solicitação exigem login
router.use(authMiddleware);

router.get('/', getAllSolicitacoes);
router.post('/', createSolicitacao);
router.get('/:id', getSolicitacaoById);
router.patch('/:id/status', updateStatusSolicitacao); 
router.get('/latest', getLatestSolicitacoes);
router.patch('/item/:itemId/status', updateSolicitacaoItemStatus);

export default router;