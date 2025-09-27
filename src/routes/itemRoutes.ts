// src/routes/itemRoutes.ts
import { Router } from 'express';
import { getAllItems, createItem, updateItem, deleteItem } from '../controllers/itemController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Todas as rotas de itens exigem autenticação
router.use(authMiddleware);

router.get('/', getAllItems);
router.post('/', createItem);
router.put('/:id', updateItem);
router.delete('/:id', deleteItem);

export default router;