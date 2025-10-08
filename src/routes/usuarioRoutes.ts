// src/routes/usuarioRoutes.ts
import { Router } from 'express';
import { getAllUsers, createUser, deleteUser, updateUser, resetPasswordByAdmin  } from '../controllers/usuarioController';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getAllUsers);
router.post('/', adminOnlyMiddleware, createUser);
router.delete('/:id', adminOnlyMiddleware, deleteUser);
router.put('/:id', adminOnlyMiddleware, updateUser);
router.put('/reset-password', adminOnlyMiddleware, resetPasswordByAdmin);

export default router;