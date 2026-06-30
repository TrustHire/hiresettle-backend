/**
 * Scenario: notification stream (SSE)
 * Opens SSE connections and measures time-to-first-byte.
 * Target: p95 < 200ms at 100 concurrent users
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const ttfbTrend = new Trend('sse_ttfb_p95');
const errorRate = new Rate('sse_errors');

export const options = {
  scenarios: {
    notification_stream: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
    },
  },
  thresholds: {
    sse_ttfb_p95: ['p(95)<200'],
    sse_errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.AUTH_TOKEN || '';

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/notifications/stream`, {
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'text/event-stream',
    },
    timeout: '5s',
  });

  const ok = check(res, {
    'connection accepted': (r) => r.status === 200 || r.status === 204,
    'ttfb < 200ms': (r) => r.timings.waiting < 200,
  });

  ttfbTrend.add(res.timings.waiting);
  errorRate.add(!ok);

  sleep(1);
}
