// src/routes/solicitacaoRoutes.ts
import { Router } from 'express';
import { getAllSolicitacoes, createSolicitacao, getSolicitacaoById, updateStatusSolicitacao, getLatestSolicitacoes, updateSolicitacaoItemStatus, cancelarItemSolicitacao, 
  sinalizarDefeitoItem } from '../controllers/solicitacaoController';
import { authMiddleware, blockManagerMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getAllSolicitacoes);
router.post('/', blockManagerMiddleware, createSolicitacao);

router.get('/latest', getLatestSolicitacoes);
router.get('/:id', getSolicitacaoById);
router.patch('/:id/status', updateStatusSolicitacao); 
router.patch('/item/:itemId/status', updateSolicitacaoItemStatus);
router.put('/itens/:itemId/cancelar', cancelarItemSolicitacao);
router.put('/itens/:itemId/defeito', sinalizarDefeitoItem);

export default router;