// src/routes/patrimonioRoutes.ts
import { Router } from 'express';
import {
  getAllBens,
  transferirBens,
  importarDadosSipac,
  registrarConferencia
} from '../controllers/patrimonioController';
import { authMiddleware, managerOrAdminMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Protege todas as rotas exigindo token válido
router.use(authMiddleware);

// Restringe o acesso apenas para admin e gerente
router.use(managerOrAdminMiddleware);

// Rota para listar bens (aceita query params: ?unidade_id=X & busca=Y)
router.get('/', getAllBens);

// Rota para registrar transferência de bens entre unidades
router.post('/transferencia', transferirBens);

// Rota para importar a lista de bens extraída do SIPAC (PDF)
router.post('/importar', importarDadosSipac);

// Rota para registrar um item conferido no levantamento
router.post('/conferencia', registrarConferencia);

export default router;