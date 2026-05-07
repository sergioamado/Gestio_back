// src/routes/estatisticasRoutes.ts
import { Router } from 'express';
import { getDashboardStats } from '../controllers/estatisticasController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

// GET /api/estatisticas
router.get('/', getDashboardStats);

export default router;