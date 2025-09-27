// src/routes/usuarioRoutes.ts
import { Router } from 'express';
import { getAllUsers, createUser, deleteUser, updateUser, resetPasswordByAdmin  } from '../controllers/usuarioController';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware, adminOnlyMiddleware);

router.get('/', getAllUsers);
router.post('/', createUser);
router.delete('/:id', deleteUser);
router.put('/:id', updateUser);
router.put('/reset-password', resetPasswordByAdmin);

export default router;