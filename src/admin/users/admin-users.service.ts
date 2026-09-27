import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    return user;
  }

  async createNote(userId: string, authorId: string, body: string) {
    await this.ensureUserExists(userId);

    return this.prisma.adminUserNote.create({
      data: {
        userId,
        authorId,
        body,
      },
      select: {
        id: true,
        userId: true,
        authorId: true,
        body: true,
        createdAt: true,
      },
    });
  }

  async findNotes(userId: string) {
    await this.ensureUserExists(userId);

    return this.prisma.adminUserNote.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userId: true,
        authorId: true,
        body: true,
        createdAt: true,
      },
    });
  }

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }
  }
}
