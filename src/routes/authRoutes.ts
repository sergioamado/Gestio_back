// src/routes/authRoutes.ts
import { Router } from 'express';
import { changePassword, login } from '../controllers/authController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.post('/login', login);
router.put('/change-password', authMiddleware, changePassword);

export default router;