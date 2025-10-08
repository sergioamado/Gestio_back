// src/routes/itemRoutes.ts
import { Router } from 'express';
import { getAllItems, createItem, updateItem, deleteItem } from '../controllers/itemController';
import { authMiddleware, managerOrAdminMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Todas as rotas de itens exigem autenticação
router.use(authMiddleware);

router.get('/', getAllItems);
router.post('/', managerOrAdminMiddleware, createItem);
router.put('/:id',managerOrAdminMiddleware, updateItem);
router.delete('/:id',managerOrAdminMiddleware, deleteItem);

export default router;