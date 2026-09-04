// src/routes/manutencaoEletronicaRoutes.ts
import { Router } from 'express';
import { createManutencao, finalizarManutencao, getAllManutencoes, iniciarManutencao, updateStatusManutencao, editarManutencao } from '../controllers/manutencaoEletronicaController';
import { authMiddleware, eletronicauAdminMiddlewareOuManager } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getAllManutencoes);
router.post('/', createManutencao);

router.patch('/:id/status', eletronicauAdminMiddlewareOuManager, updateStatusManutencao);
router.patch('/:id/iniciar', eletronicauAdminMiddlewareOuManager, iniciarManutencao);
router.patch('/:id/finalizar', eletronicauAdminMiddlewareOuManager, finalizarManutencao);
router.put('/:id', editarManutencao);
export default router;