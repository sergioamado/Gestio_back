// src/routes/manutencaoEletronicaRoutes.ts
import { Router } from 'express';
import { createManutencao, finalizarManutencao, getAllManutencoes, iniciarManutencao, updateStatusManutencao } from '../controllers/manutencaoEletronicaController';
import { authMiddleware, eletronicaOuAdminMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getAllManutencoes);
router.post('/', createManutencao);

router.patch('/:id/status', eletronicaOuAdminMiddleware, updateStatusManutencao);
router.patch('/:id/iniciar', eletronicaOuAdminMiddleware, iniciarManutencao);
router.patch('/:id/finalizar', eletronicaOuAdminMiddleware, finalizarManutencao);

export default router;