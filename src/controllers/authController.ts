// src/controllers/authController.ts
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import argon2 from 'argon2';
import { formatarEspera, registrarFalha, registrarSucesso, tempoBloqueado } from '../security/loginThrottle';

const prisma = new PrismaClient();

export const login = async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
    return res.status(400).json({ message: 'Usuário e senha são obrigatórios.' });
  }

  // Bloqueio progressivo: checado antes da senha, e vale também para usuários inexistentes
  // (assim a resposta não revela quais nomes de usuário existem).
  const restante = tempoBloqueado(username);
  if (restante > 0) {
    res.setHeader('Retry-After', Math.ceil(restante / 1000).toString());
    return res.status(429).json({
      message: `Muitas tentativas de login. Aguarde ${formatarEspera(restante)} e tente novamente.`,
      retry_after: Math.ceil(restante / 1000),
    });
  }

  const falhaDeLogin = () => {
    const bloqueio = registrarFalha(username);
    if (bloqueio > 0) {
      res.setHeader('Retry-After', Math.ceil(bloqueio / 1000).toString());
      return res.status(429).json({
        message: `Credenciais inválidas. Muitas tentativas: aguarde ${formatarEspera(bloqueio)} para tentar de novo.`,
        retry_after: Math.ceil(bloqueio / 1000),
      });
    }
    return res.status(401).json({ message: 'Credenciais inválidas.' });
  };

  try {
    const user = await prisma.usuarios.findUnique({ where: { username } });

    if (!user) {
      return falhaDeLogin();
    }

    let passwordIsValid = false;

    if (user.hashed_password.startsWith('$argon2')) {
      if (await argon2.verify(user.hashed_password, password)) {
        passwordIsValid = true;
        const newHashedPassword = await bcrypt.hash(password, 10);
        await prisma.usuarios.update({
          where: { id: user.id },
          data: { hashed_password: newHashedPassword },
        });
      }
    } else {
      passwordIsValid = await bcrypt.compare(password, user.hashed_password);
    }

    if (!passwordIsValid) {
      return falhaDeLogin();
    }

    registrarSucesso(username);

    const token = jwt.sign(
      { id: user.id, role: user.role, unidade_id: user.unidade_id },
      process.env.JWT_SECRET as string,
      { expiresIn: '8h' }
    );

    // CORRIGIDO: Retornar o objeto de usuário completo, excluindo apenas a senha
    // Nunca devolve ao navegador a senha nem o código temporário de vinculação do Telegram.
    const { hashed_password, telegram_token, ...userResponse } = user;

    res.json({
      message: 'Login bem-sucedido!',
      token,
      user: userResponse,
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
  const userId = req.user!.id;
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ message: 'Senha atual e nova senha (mínimo 6 caracteres) são obrigatórias.' });
  }

  try {
    const user = await prisma.usuarios.findUnique({ where: { id: userId } });
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

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