// src/routes/solicitacaoRoutes.ts
import { Router } from 'express';
import { getAllSolicitacoes, createSolicitacao, getSolicitacaoById, getLatestSolicitacoes,
  updateSolicitacao, converterTesteEmConsumo } from '../controllers/solicitacaoController';
import { authMiddleware, tecnicoOnlyMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getAllSolicitacoes);
router.post('/', tecnicoOnlyMiddleware, createSolicitacao);

router.get('/latest', getLatestSolicitacoes);
router.get('/:id', getSolicitacaoById);
// Todas as mudanças de status (OS e peças) passam por aqui e seguem src/rules/solicitacaoRules.ts.
// Os antigos PATCH /:id/status, PATCH /item/:itemId/status, /cancelar e /defeito foram removidos:
// não eram usados pelo front e permitiam alterar status/estoque sem checar papel.
router.put('/:id', updateSolicitacao);
router.put('/item/:itemId/converter-consumo', converterTesteEmConsumo);

export default router;