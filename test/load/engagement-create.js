/**
 * Scenario: engagement creation (write + Soroban stub)
 * Target: p95 < 200ms at 100 concurrent users
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const p95Latency = new Trend('engagement_create_p95');
const errorRate = new Rate('engagement_create_errors');

export const options = {
  scenarios: {
    engagement_create: {
      executor: 'constant-vus',
      vus: 100,
      duration: '60s',
    },
  },
  thresholds: {
    engagement_create_p95: ['p(95)<200'],
    engagement_create_errors: ['rate<0.01'],
  },
};

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const TOKEN = __ENV.AUTH_TOKEN || '';

function makeEngagementPayload(vu, iter) {
  return JSON.stringify({
    contractEngagementId: `test-${vu}-${iter}-${Date.now()}`,
    recruiterAddress: 'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
    companyAddress: 'GBVKI23OQZCANDUZ5J3YPE6WPJF7ASCZC6RI4LNSYXCGMHLZJFEMFWM',
    totalAmount: '100.0000000',
    tokenAddress: 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
    milestones: [
      { index: 0, amount: '50.0000000', kind: 'FIXED', retentionDays: 30 },
      { index: 1, amount: '50.0000000', kind: 'RETENTION', retentionDays: 60 },
    ],
    currentLedger: 1000000,
  });
}

export default function () {
  const payload = makeEngagementPayload(__VU, __ITER);
  const res = http.post(`${BASE_URL}/api/v1/engagements`, payload, {
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
  });

  const ok = check(res, {
    'status is 201': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  p95Latency.add(res.timings.duration);
  errorRate.add(!ok);

  sleep(1);
}
