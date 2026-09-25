import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { HibpService } from './hibp.service';

// ── helpers ───────────────────────────────────────────────────────────────────

function sha1Hex(password: string): string {
  return createHash('sha1').update(password).digest('hex').toUpperCase();
}

function buildApiResponse(password: string, count = 1, extraLines: string[] = []): string {
  const full = sha1Hex(password);
  const suffix = full.slice(5);
  const lines = [`${suffix}:${count}`, ...extraLines];
  return lines.join('\r\n');
}

// ── mock fetch helper ─────────────────────────────────────────────────────────

function mockFetch(responseText: string, status = 200) {
  global.fetch = jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: jest.fn().mockResolvedValue(responseText),
  });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe('HibpService', () => {
  let service: HibpService;

  const makeMockConfig = (overrides: Record<string, any> = {}) => ({
    get: jest.fn((key: string, def?: any) => overrides[key] ?? def ?? null),
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HibpService,
        { provide: ConfigService, useValue: makeMockConfig() },
      ],
    }).compile();

    service = module.get<HibpService>(HibpService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ── isBreached — found ────────────────────────────────────────────────────

  it('returns true when the password suffix is in the response', async () => {
    mockFetch(buildApiResponse('password123', 53141));
    const result = await service.isBreached('password123');
    expect(result).toBe(true);
  });

  it('returns true when there are multiple entries and password is one of them', async () => {
    const responseText = buildApiResponse('secret', 1, [
      'AAAAABBBBBCCCCCDDDDDEEEEEFFFFFF00000:10',
      'AAAA0111111111111111111111111111111:5',
    ]);
    mockFetch(responseText);
    const result = await service.isBreached('secret');
    expect(result).toBe(true);
  });

  // ── isBreached — not found ────────────────────────────────────────────────

  it('returns false when the suffix is not in the response', async () => {
    // Build response with a different password so the suffix won't match
    mockFetch(buildApiResponse('completely-different-password', 1));
    const result = await service.isBreached('someUniquePassword!XYZ789');
    expect(result).toBe(false);
  });

  it('returns false for an empty response body', async () => {
    mockFetch('');
    const result = await service.isBreached('anypassword');
    expect(result).toBe(false);
  });

  // ── only sends first 5 SHA-1 chars ────────────────────────────────────────

  it('sends only the first 5 SHA-1 hex chars to the API', async () => {
    mockFetch(buildApiResponse('testpassword', 0));

    await service.isBreached('testpassword');

    const prefix = sha1Hex('testpassword').slice(0, 5);
    expect(global.fetch).toHaveBeenCalledWith(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      expect.any(Object),
    );
  });

  it('never includes the full SHA-1 or raw password in the URL', async () => {
    mockFetch('');
    await service.isBreached('hunter2');

    const calledUrl: string = (global.fetch as jest.Mock).mock.calls[0][0];
    const fullHash = sha1Hex('hunter2');
    expect(calledUrl).not.toContain(fullHash);
    expect(calledUrl).not.toContain('hunter2');
    // URL should end with the 5-char prefix
    expect(calledUrl).toMatch(/\/range\/[0-9A-F]{5}$/);
  });

  // ── fail-open on network errors ───────────────────────────────────────────

  it('returns false when fetch throws (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const result = await service.isBreached('anypassword');
    expect(result).toBe(false);
  });

  it('returns false when fetch is aborted (timeout)', async () => {
    global.fetch = jest.fn().mockRejectedValue(
      Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
    );
    const result = await service.isBreached('anypassword');
    expect(result).toBe(false);
  });

  it('returns false when the API returns a non-OK status', async () => {
    mockFetch('Service Unavailable', 503);
    const result = await service.isBreached('anypassword');
    expect(result).toBe(false);
  });
});
