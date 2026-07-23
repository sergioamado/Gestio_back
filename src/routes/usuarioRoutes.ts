// src/routes/usuarioRoutes.ts
import { Router } from 'express';
import { getAllUsers, createUser, deleteUser, updateUser, resetPasswordByAdmin  } from '../controllers/usuarioController';
import { authMiddleware, adminOnlyMiddleware } from '../middlewares/authMiddleware';
import { gerarLinkTelegram, atualizarPreferenciasNotificacao } from '../controllers/usuarioController';

const router = Router();

router.use(authMiddleware);

router.get('/', getAllUsers);
router.post('/', adminOnlyMiddleware, createUser);
router.delete('/:id', adminOnlyMiddleware, deleteUser);
router.put('/reset-password', adminOnlyMiddleware, resetPasswordByAdmin);
router.put('/:id', adminOnlyMiddleware, updateUser);
router.get('/telegram/gerar-link', authMiddleware, gerarLinkTelegram);
router.put('/preferencias-notificacoes', authMiddleware, atualizarPreferenciasNotificacao);

export default router;