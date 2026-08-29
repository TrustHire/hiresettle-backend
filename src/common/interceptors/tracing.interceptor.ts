import { Injectable, NestInterceptor, ExecutionContext, CallHandler } from '@nestjs/common';
import { Observable } from 'rxjs';
import { trace } from '@opentelemetry/api';
import { randomUUID } from 'crypto';

@Injectable()
export class TracingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const span = trace.getActiveSpan();

    if (span) {
      const req = context.switchToHttp().getRequest();
      const requestId = req.headers['x-request-id'] || randomUUID();
      const engagementId = req.params?.engagementId || req.params?.id || req.body?.engagementId;

      req.requestId = requestId;
      span.setAttribute('request.id', requestId);
      if (req.user?.id) {
        span.setAttribute('user.id', req.user.id);
      }
      if (engagementId) {
        span.setAttribute('engagement.id', engagementId);
      }
    }

    return next.handle();
  }
}
