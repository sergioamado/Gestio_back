// src/routes/unidadeRoutes.ts
import { Router } from 'express';
import { getAllUnidades, createUnidade, updateUnidade, deleteUnidade } from '../controllers/unidadeController';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Todas as rotas de unidades exigem login e perfil de admin
router.use(authMiddleware);

router.get('/', getAllUnidades);
router.post('/', adminOnlyMiddleware, createUnidade);
router.put('/:id', adminOnlyMiddleware, updateUnidade);
router.delete('/:id', adminOnlyMiddleware, deleteUnidade);

export default router;