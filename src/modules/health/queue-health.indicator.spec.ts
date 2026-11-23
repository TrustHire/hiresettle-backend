import { Test, TestingModule } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { QueueHealthIndicator } from './queue-health.indicator';

describe('QueueHealthIndicator', () => {
  let indicator: QueueHealthIndicator;
  let mockClient: { ping: jest.Mock };
  let mockQueue: {
    client: Promise<{ ping: jest.Mock }>;
    getWaitingCount: jest.Mock;
    getActiveCount: jest.Mock;
    getDelayedCount: jest.Mock;
    getFailedCount: jest.Mock;
  };

  beforeEach(async () => {
    mockClient = { ping: jest.fn() };
    mockQueue = {
      client: Promise.resolve(mockClient),
      getWaitingCount: jest.fn(),
      getActiveCount: jest.fn(),
      getDelayedCount: jest.fn(),
      getFailedCount: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueHealthIndicator,
        { provide: getQueueToken('email'), useValue: mockQueue },
      ],
    }).compile();

    indicator = module.get<QueueHealthIndicator>(QueueHealthIndicator);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns up with queue counts when Redis responds PONG', async () => {
    mockClient.ping.mockResolvedValue('PONG');
    mockQueue.getWaitingCount.mockResolvedValue(2);
    mockQueue.getActiveCount.mockResolvedValue(1);
    mockQueue.getDelayedCount.mockResolvedValue(0);
    mockQueue.getFailedCount.mockResolvedValue(3);

    const result = await indicator.isHealthy();

    expect(result).toEqual({
      queues: {
        status: 'up',
        redis: 'connected',
        waiting: 2,
        active: 1,
        delayed: 0,
        failed: 3,
      },
    });
  });

  it('returns down when Redis ping returns an unexpected value', async () => {
    mockClient.ping.mockResolvedValue('LOADING');

    const result = await indicator.isHealthy();

    expect(result).toEqual({
      queues: {
        status: 'down',
        message: 'Unexpected Redis response: LOADING',
      },
    });
    expect(mockQueue.getWaitingCount).not.toHaveBeenCalled();
  });

  it('returns down when Redis client or ping throws', async () => {
    mockClient.ping.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await indicator.isHealthy();

    expect(result).toEqual({
      queues: {
        status: 'down',
        message: 'ECONNREFUSED',
      },
    });
  });

  it('returns down when fetching queue counts fails', async () => {
    mockClient.ping.mockResolvedValue('PONG');
    mockQueue.getWaitingCount.mockRejectedValue(new Error('Redis timeout'));

    const result = await indicator.isHealthy();

    expect(result).toEqual({
      queues: {
        status: 'down',
        message: 'Redis timeout',
      },
    });
  });
});
