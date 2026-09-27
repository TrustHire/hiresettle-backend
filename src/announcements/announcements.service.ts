import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, IsNull, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { Announcement } from './entities/announcement.entity';
import { AnnouncementDismissal } from './entities/announcement-dismissal.entity';
import { CreateAnnouncementDto } from './dto/create-announcement.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    @InjectRepository(Announcement)
    private readonly announcementsRepository: Repository<Announcement>,
    @InjectRepository(AnnouncementDismissal)
    private readonly dismissalsRepository: Repository<AnnouncementDismissal>,
  ) {}

  async create(dto: CreateAnnouncementDto): Promise<Announcement> {
    const announcement = this.announcementsRepository.create({
      title: dto.title,
      body: dto.body,
      targetRole: dto.targetRole ?? null,
      startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
      endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
    });
    return this.announcementsRepository.save(announcement);
  }

  async findAll(): Promise<Announcement[]> {
    return this.announcementsRepository.find({ order: { createdAt: 'DESC' } });
  }

  async findActiveForUser(user: { id: string; role?: string }): Promise<Announcement[]> {
    const now = new Date();
    const announcements = await this.announcementsRepository.find({
      where: [
        { targetRole: IsNull() },
        { targetRole: user.role ?? '' },
      ],
      order: { createdAt: 'DESC' },
    });

    const active = announcements.filter((a) => {
      if (a.startsAt && a.startsAt > now) return false;
      if (a.endsAt && a.endsAt < now) return false;
      return true;
    });

    if (active.length === 0) return [];

    const dismissals = await this.dismissalsRepository.find({
      where: {
        userId: user.id,
        announcementId: In(active.map((a) => a.id)),
      },
    });
    const dismissedIds = new Set(dismissals.map((d) => d.announcementId));

    return active.filter((a) => !dismissedIds.has(a.id));
  }

  async dismiss(announcementId: string, userId: string): Promise<void> {
    const announcement = await this.announcementsRepository.findOne({
      where: { id: announcementId },
    });
    if (!announcement) {
      throw new NotFoundException('Announcement not found');
    }

    const existing = await this.dismissalsRepository.findOne({
      where: { announcementId, userId },
    });
    if (existing) return;

    const dismissal = this.dismissalsRepository.create({ announcementId, userId });
    await this.dismissalsRepository.save(dismissal);
  }
}
