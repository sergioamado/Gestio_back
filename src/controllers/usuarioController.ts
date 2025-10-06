// src/controllers/usuarioController.ts
import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const usuarioSchema = z.object({
  username: z.string().min(3),
  nome_completo: z.string().min(3),
  role: z.enum(['admin', 'gerente', 'tecnico']),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  unidade_id: z.number().int().nullable(),
  password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres"),
});

export const getAllUsers = async (req: Request, res: Response) => {
  const users = await prisma.usuarios.findMany({
    orderBy: { nome_completo: 'asc' },
    // Selecionamos os campos para não expor a senha
    select: {
      id: true,
      username: true,
      nome_completo: true,
      role: true,
      unidade_id: true,
      unidades_organizacionais: { // Incluindo o nome da unidade relacionada
        select: {
          nome: true
        }
      }
    }
  });
  res.json(users);
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const { password, ...data } = usuarioSchema.parse(req.body);
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = await prisma.usuarios.create({
      data: {
        ...data,
        hashed_password: hashedPassword,
      },
    });
    // Omitir a senha da resposta
    const { hashed_password, ...userResponse } = newUser;
    res.status(201).json(userResponse);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos ou usuário já existe.', details: error });
  }
};

const updateUserSchema = z.object({
  nome_completo: z.string().min(3),
  role: z.enum(['admin', 'gerente', 'tecnico']),
  telefone: z.string().optional(),
  email: z.string().email().optional(),
  unidade_id: z.number().int().nullable(),
});

export const updateUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const data = updateUserSchema.parse(req.body);
    const user = await prisma.usuarios.update({
      where: { id: Number(id) },
      data,
    });
    const { hashed_password, ...userResponse } = user;
    res.json(userResponse);
  } catch (error) {
    res.status(400).json({ message: 'Dados inválidos ou usuário não encontrado.' });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  // Impede que o usuário se auto-delete
  if (req.user?.id === Number(id)) {
      return res.status(403).json({ message: 'Você не pode excluir a si mesmo.' });
  }

  try {
    await prisma.usuarios.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao deletar. O usuário pode ser responsável por solicitações existentes.' });
  }
};

export const resetPasswordByAdmin = async (req: Request, res: Response) => {
  const { username, newPassword } = req.body;

  // Validação dos dados recebidos
  if (!username || !newPassword || newPassword.length < 6) {
    return res.status(400).json({ 
      message: 'Nome de usuário e uma nova senha com no mínimo 6 caracteres são obrigatórios.' 
    });
  }

  try {
    // Busca o usuário pelo username fornecido
    const user = await prisma.usuarios.findUnique({ where: { username } });

    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    // Gera o hash da nova senha
    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    // Atualiza a senha do usuário no banco de dados
    await prisma.usuarios.update({
      where: { id: user.id },
      data: { hashed_password: newHashedPassword },
    });

    res.json({ message: `Senha do usuário '${username}' alterada com sucesso!` });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Erro interno no servidor ao tentar alterar a senha.' });
  }
};