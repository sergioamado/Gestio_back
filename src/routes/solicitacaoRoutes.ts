// src/routes/solicitacaoRoutes.ts
import { Router } from 'express';
import { getAllSolicitacoes, createSolicitacao, getSolicitacaoById, updateStatusSolicitacao, getLatestSolicitacoes, updateSolicitacaoItemStatus } from '../controllers/solicitacaoController';
import { authMiddleware, blockManagerMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getAllSolicitacoes);
router.post('/', blockManagerMiddleware, createSolicitacao);

router.get('/latest', getLatestSolicitacoes);
router.get('/:id', getSolicitacaoById);
router.patch('/:id/status', updateStatusSolicitacao); 
router.patch('/item/:itemId/status', updateSolicitacaoItemStatus);

export default router;