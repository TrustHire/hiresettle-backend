import { Injectable, NotFoundException, ConflictException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateSavedFilterDto } from './dto/create-saved-filter.dto';

/**
 * SavedFiltersService — manages named engagement filter presets per user (#253).
 *
 * Presets store the same filter query object that GET /engagements accepts,
 * so applying a preset is identical to entering those filters manually.
 */
@Injectable()
export class SavedFiltersService {
  private readonly logger = new Logger(SavedFiltersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Return all saved filter presets for the given user. */
  async findAll(userId: string) {
    return this.prisma.savedFilter.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
  }

  /** Return a single saved filter, throwing 404 if it doesn't belong to the user. */
  async findOne(userId: string, filterId: string) {
    const filter = await this.prisma.savedFilter.findUnique({ where: { id: filterId } });
    if (!filter) throw new NotFoundException(`Saved filter ${filterId} not found`);
    if (filter.userId !== userId) throw new ForbiddenException('This filter does not belong to you');
    return filter;
  }

  /** Create a named preset. Raises 409 if the user already has a preset with the same name. */
  async create(userId: string, dto: CreateSavedFilterDto) {
    const existing = await this.prisma.savedFilter.findUnique({
      where: { userId_name: { userId, name: dto.name } },
    });
    if (existing) {
      throw new ConflictException(`A saved filter named "${dto.name}" already exists`);
    }

    const saved = await this.prisma.savedFilter.create({
      data: {
        userId,
        name: dto.name,
        filters: dto.filters,
      },
    });

    this.logger.log(`Saved filter "${dto.name}" created for user ${userId}`);
    return saved;
  }

  /** Delete a preset that belongs to the given user. */
  async remove(userId: string, filterId: string) {
    const filter = await this.prisma.savedFilter.findUnique({ where: { id: filterId } });
    if (!filter) throw new NotFoundException(`Saved filter ${filterId} not found`);
    if (filter.userId !== userId) throw new ForbiddenException('This filter does not belong to you');

    await this.prisma.savedFilter.delete({ where: { id: filterId } });
    this.logger.log(`Saved filter ${filterId} deleted for user ${userId}`);
    return { success: true };
  }
}
