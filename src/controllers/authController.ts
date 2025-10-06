// src/controllers/authController.ts
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import argon2 from 'argon2';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
  }

  try {
    const user = await prisma.usuarios.findUnique({ where: { username } });

    if (!user) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    let passwordIsValid = false;

    // Lógica de migração de senha
    if (user.hashed_password.startsWith('$argon2')) {
      // Senha antiga (Argon2), verifica e migra
      if (await argon2.verify(user.hashed_password, password)) {
        passwordIsValid = true;
        // A senha está correta, vamos gerar um novo hash com bcrypt e atualizar no banco
        const newHashedPassword = await bcrypt.hash(password, 10);
        await prisma.usuarios.update({
          where: { id: user.id },
          data: { hashed_password: newHashedPassword },
        });
      }
    } else {
      // Senha já migrada (Bcrypt)
      passwordIsValid = await bcrypt.compare(password, user.hashed_password);
    }

    if (!passwordIsValid) {
      return res.status(401).json({ message: 'Credenciais inválidas.' });
    }

    // Gerar o Token JWT
    const token = jwt.sign(
      { id: user.id, role: user.role, unidade_id: user.unidade_id },
      process.env.JWT_SECRET as string,
      { expiresIn: '8h' } // Token expira em 8 horas
    );

    res.json({
      message: 'Login bem-sucedido!',
      token,
      user: {
        id: user.id,
        nome_completo: user.nome_completo,
        role: user.role,
      },
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro interno no servidor.' });
  }
};

export const adminOnlyMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: 'Acesso negado. Requer perfil de administrador.' });
  }
  next();
};

export const changePassword = async (req: Request, res: Response) => {
  const userId = req.user!.id; // Pega o ID do usuário logado pelo token
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: 'Senha atual e nova senha (mínimo 6 caracteres) são obrigatórias.' });
  }

  try {
    const user = await prisma.usuarios.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'Usuário не encontrado.' });
    }

    // A senha do usuário já deve estar em bcrypt neste ponto
    const passwordIsValid = await bcrypt.compare(currentPassword, user.hashed_password);
    if (!passwordIsValid) {
      return res.status(401).json({ message: 'A senha atual está incorreta.' });
    }

    const newHashedPassword = await bcrypt.hash(newPassword, 10);
    await prisma.usuarios.update({
      where: { id: userId },
      data: { hashed_password: newHashedPassword },
    });

    res.json({ message: 'Senha alterada com sucesso!' });
  } catch (error) {
    res.status(500).json({ message: 'Erro interno no servidor.' });
  }
};