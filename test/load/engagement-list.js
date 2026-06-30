/**
 * Scenario: engagement list (read-heavy)
 * Target: p95 < 200ms at 100 concurrent users
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const p95Latency = new Trend('engagement_list_p95');
const errorRate = new Rate('engagement_list_errors');

export const options = {
  scenarios: {
    engagement_list: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
    },
  },
  thresholds: {
    engagement_list_p95: ['p(95)<200'],
    engagement_list_errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.AUTH_TOKEN || '';

export function setup() {
  if (!TOKEN) {
    console.warn('AUTH_TOKEN not set — requests will return 401');
  }
}

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/engagements`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  const ok = check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  p95Latency.add(res.timings.duration);
  errorRate.add(!ok);

  sleep(0.5);
}
