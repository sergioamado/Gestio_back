// src/routes/registroProducaoRoutes.ts
import { Router } from 'express';
//  Importação a apontar corretamente para o controller separado
import { registrarProducao, getHistoricoProducao, deleteProducao } from '../controllers/registroProducaoController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Todas as rotas de serviços requerem que o usuário esteja logado
router.use(authMiddleware);

// --- ROTAS DE PRODUÇÃO ---

// Qualquer técnico pode registrar a sua produção
router.post('/producao', registrarProducao);

// Todos podem ver o histórico (a separação entre admin e técnico é feita dentro do controller)
router.get('/producao', getHistoricoProducao);

// Qualquer pessoa autenticada pode tentar apagar (a validação de segurança de quem pode apagar o quê está no controller)
router.delete('/producao/:id', deleteProducao);

export default router;