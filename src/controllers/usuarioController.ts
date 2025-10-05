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
  telefone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
  unidade_id: z.number().int().nullable(),
  password: z.string().min(6, "A senha deve ter no mínimo 6 caracteres"),
});

export const getAllUsers = async (req: Request, res: Response) => {
  try {
    const users = await prisma.usuarios.findMany({
      orderBy: { nome_completo: 'asc' },
      select: {
        id: true,
        username: true,
        nome_completo: true,
        role: true,
        telefone: true,
        email: true,
        unidade_id: true,
        unidades_organizacionais: {
          select: { nome: true }
        }
      }
    });
    res.json(users);
  } catch (error) {
    console.error("Erro ao buscar utilizadores:", error);
    res.status(500).json({ message: "Ocorreu um erro no servidor ao buscar os utilizadores." });
  }
};

export const createUser = async (req: Request, res: Response) => {
  try {
    const body = { ...req.body, telefone: req.body.telefone || null, email: req.body.email || null };
    const { password, ...data } = usuarioSchema.parse(body);
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const newUser = await prisma.usuarios.create({
      data: {
        ...data,
        hashed_password: hashedPassword,
      },
    });
    const { hashed_password, ...userResponse } = newUser;
    res.status(201).json(userResponse);
  } catch (error: any) {
    let errorMessage = 'Dados inválidos ou utilizador já existe.';
    if (error.code === 'P2002') { // Código de erro do Prisma para violação de constraint única
      errorMessage = `O valor para '${error.meta.target}' já está em uso.`;
    }
    res.status(400).json({ message: errorMessage });
  }
};


const updateUserSchema = z.object({
  nome_completo: z.string().min(3),
  role: z.enum(['admin', 'gerente', 'tecnico']),
  telefone: z.string().optional().nullable(),
  email: z.string().email().optional().nullable(),
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
    res.status(400).json({ message: 'Dados inválidos ou utilizador não encontrado.' });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  const { id } = req.params;
  
  if (req.user?.id === Number(id)) {
      return res.status(403).json({ message: 'Você não pode excluir a si mesmo.' });
  }

  try {
    await prisma.usuarios.delete({ where: { id: Number(id) } });
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ message: 'Erro ao eliminar. O utilizador pode ser responsável por solicitações existentes.' });
  }
};

export const resetPasswordByAdmin = async (req: Request, res: Response) => {
    const { username, newPassword } = req.body;

    if (!username || !newPassword || newPassword.length < 6) {
        return res.status(400).json({ 
        message: 'Nome de utilizador e uma nova senha com no mínimo 6 caracteres são obrigatórios.' 
        });
    }

    try {
        const user = await prisma.usuarios.findUnique({ where: { username } });

        if (!user) {
        return res.status(404).json({ message: 'Utilizador não encontrado.' });
        }

        const newHashedPassword = await bcrypt.hash(newPassword, 10);

        await prisma.usuarios.update({
        where: { id: user.id },
        data: { hashed_password: newHashedPassword },
        });

        res.json({ message: `Senha do utilizador '${username}' alterada com sucesso!` });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erro interno no servidor ao tentar alterar a senha.' });
    }
};