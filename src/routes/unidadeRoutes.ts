// src/routes/unidadeRoutes.ts
import { Router } from 'express';
import { getAllUnidades, createUnidade, updateUnidade, deleteUnidade } from '../controllers/unidadeController';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Todas as rotas de unidades exigem login e perfil de admin
router.use(authMiddleware, adminOnlyMiddleware);

router.get('/', getAllUnidades);
router.post('/', createUnidade);
router.put('/:id', updateUnidade);
router.delete('/:id', deleteUnidade);

export default router;