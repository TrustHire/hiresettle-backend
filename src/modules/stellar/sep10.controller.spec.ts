import { Test, TestingModule } from '@nestjs/testing';
import { Sep10Controller } from './sep10.controller';
import { Sep10Service } from './sep10.service';

describe('Sep10Controller', () => {
  let controller: Sep10Controller;
  let sep10Service: {
    createChallenge: jest.Mock;
    verifyChallenge: jest.Mock;
  };

  beforeEach(async () => {
    sep10Service = {
      createChallenge: jest.fn(),
      verifyChallenge: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [Sep10Controller],
      providers: [{ provide: Sep10Service, useValue: sep10Service }],
    }).compile();

    controller = module.get<Sep10Controller>(Sep10Controller);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('challenge() delegates to Sep10Service.createChallenge', async () => {
    const challenge = {
      transaction: 'AAAA...',
      network_passphrase: 'Test SDF Network ; September 2015',
    };
    sep10Service.createChallenge.mockResolvedValue(challenge);

    const res = await controller.challenge('GABC123');

    expect(sep10Service.createChallenge).toHaveBeenCalledWith('GABC123');
    expect(res).toEqual(challenge);
  });

  it('verify() delegates to Sep10Service.verifyChallenge and returns verified payload', async () => {
    sep10Service.verifyChallenge.mockResolvedValue('GABC123');

    const res = await controller.verify({ transaction: 'SIGNED_XDR' });

    expect(sep10Service.verifyChallenge).toHaveBeenCalledWith('SIGNED_XDR');
    expect(res).toEqual({ stellar_account: 'GABC123', verified: true });
  });
});
