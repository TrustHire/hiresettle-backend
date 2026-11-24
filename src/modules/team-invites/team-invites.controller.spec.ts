import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TeamInvitesController } from './team-invites.controller';
import { TeamInvitesService } from './team-invites.service';
import { FeatureFlagsService } from '../feature-flags/feature-flags.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';

describe('TeamInvitesController', () => {
  let controller: TeamInvitesController;
  let service: {
    sendInvite: jest.Mock;
    listInvites: jest.Mock;
    acceptInvite: jest.Mock;
    revokeInvite: jest.Mock;
  };
  let featureFlags: { isEnabled: jest.Mock };

  beforeEach(async () => {
    service = {
      sendInvite: jest.fn(),
      listInvites: jest.fn(),
      acceptInvite: jest.fn(),
      revokeInvite: jest.fn(),
    };
    featureFlags = { isEnabled: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TeamInvitesController],
      providers: [
        { provide: TeamInvitesService, useValue: service },
        { provide: FeatureFlagsService, useValue: featureFlags },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<TeamInvitesController>(TeamInvitesController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendInvite', () => {
    it('throws BadRequestException when team_invites feature flag is disabled', async () => {
      featureFlags.isEnabled.mockResolvedValue(false);

      await expect(
        controller.sendInvite({ user: { id: 'owner-1' } }, { email: 'a@b.com' }),
      ).rejects.toThrow(BadRequestException);
      expect(service.sendInvite).not.toHaveBeenCalled();
    });

    it('delegates to TeamInvitesService.sendInvite when enabled', async () => {
      featureFlags.isEnabled.mockResolvedValue(true);
      const expected = { id: 'inv-1', email: 'a@b.com', expiresAt: new Date() };
      service.sendInvite.mockResolvedValue(expected);

      const res = await controller.sendInvite({ user: { id: 'owner-1' } }, { email: 'a@b.com' });

      expect(featureFlags.isEnabled).toHaveBeenCalledWith('team_invites');
      expect(service.sendInvite).toHaveBeenCalledWith('owner-1', { email: 'a@b.com' });
      expect(res).toEqual(expected);
    });
  });

  it('listInvites delegates to TeamInvitesService.listInvites', async () => {
    service.listInvites.mockResolvedValue([{ id: 'inv-1' }]);

    const res = await controller.listInvites({ user: { id: 'owner-1' } });

    expect(service.listInvites).toHaveBeenCalledWith('owner-1');
    expect(res).toEqual([{ id: 'inv-1' }]);
  });

  it('acceptInvite delegates to TeamInvitesService.acceptInvite', async () => {
    const dto = { name: 'Jane', password: 'StrongPassword1!' };
    service.acceptInvite.mockResolvedValue({ userId: 'u-1' });

    const res = await controller.acceptInvite('tok-123', dto);

    expect(service.acceptInvite).toHaveBeenCalledWith('tok-123', dto);
    expect(res).toEqual({ userId: 'u-1' });
  });

  it('revokeInvite delegates to TeamInvitesService.revokeInvite', async () => {
    service.revokeInvite.mockResolvedValue({ revoked: true });

    const res = await controller.revokeInvite({ user: { id: 'owner-1' } }, 'inv-1');

    expect(service.revokeInvite).toHaveBeenCalledWith('owner-1', 'inv-1');
    expect(res).toEqual({ revoked: true });
  });
});
