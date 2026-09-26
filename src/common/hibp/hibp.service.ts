import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

const HIBP_API = 'https://api.pwnedpasswords.com/range/';
// Keep the User-Agent small and descriptive — HIBP asks callers to identify themselves.
const USER_AGENT = 'hiresettle-backend/hibp-check';
const REQUEST_TIMEOUT_MS = 3_000;

@Injectable()
export class HibpService {
  private readonly logger = new Logger(HibpService.name);

  constructor(private readonly config: ConfigService) {}

  /**
   * Returns true if the password appears in the HaveIBeenPwned corpus.
   *
   * Uses the k-anonymity range API:
   *   1. SHA-1 hash the password.
   *   2. Send only the first 5 hex chars to the API.
   *   3. The API returns all suffixes (35-char) that match that prefix,
   *      one per line in the format `SUFFIX:COUNT`.
   *   4. We check locally whether our suffix appears with count > 0.
   *
   * This means the raw password (and the full hash) never leaves the service.
   */
  async isBreached(password: string): Promise<boolean> {
    const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const url = `${HIBP_API}${prefix}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let responseText: string;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Add-Padding': 'true', // mitigates response-size side-channel
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        this.logger.warn(
          `HIBP API returned HTTP ${res.status} — skipping breach check`,
        );
        return false;
      }

      responseText = await res.text();
    } catch (err: any) {
      this.logger.warn(
        `HIBP API unreachable (${err?.message ?? err}) — skipping breach check`,
      );
      return false;
    } finally {
      clearTimeout(timer);
    }

    // Each line: "SUFFIX:COUNT\r\n"  (CRLF line endings from the API)
    for (const line of responseText.split('\n')) {
      const [lineSuffix, countStr] = line.trim().split(':');
      if (lineSuffix === suffix) {
        const count = parseInt(countStr, 10);
        return count > 0;
      }
    }

    return false;
  }
}
