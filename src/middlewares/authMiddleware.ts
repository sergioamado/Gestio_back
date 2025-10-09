// src/middlewares/authMiddleware.ts
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
declare global {
  namespace Express {
    interface Request {
      user?: { id: number; role: string , unidade_id: number | null};
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Acesso negado. Nenhum token fornecido.' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(
        token, 
        process.env.JWT_SECRET as string
    ) as { id: number; role: string; unidade_id: number | null };

    req.user = { id: decoded.id, role: decoded.role, unidade_id: decoded.unidade_id };
    
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Token inválido.' });
  }
};

export const adminOnlyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Acesso negado. Requer perfil de administrador.' });
  }
  next();
};

export const managerOrAdminMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin' && req.user?.role !== 'gerente') {
    return res.status(403).json({ message: 'Acesso negado. Requer perfil de gerente ou administrador.' });
  }
  next();
};

export const blockManagerMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role === 'gerente') {
    return res.status(403).json({ message: 'Acesso negado. Perfil de gerente não pode executar esta ação.' });
  }
  next();
};