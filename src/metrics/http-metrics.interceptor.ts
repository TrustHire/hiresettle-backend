import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MetricsService } from './metrics.service';

@Injectable()
export class HttpMetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<any> {
    const req = ctx.switchToHttp().getRequest();
    const { method } = req;
    const start = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const res = ctx.switchToHttp().getResponse();
          const route = req.route?.path ?? req.path ?? 'unknown';
          this.metrics.recordHttpRequest(method, route, res.statusCode, Date.now() - start);
        },
        error: (err) => {
          const status = err?.status ?? 500;
          const route = req.route?.path ?? req.path ?? 'unknown';
          this.metrics.recordHttpRequest(method, route, status, Date.now() - start);
        },
      }),
    );
  }
}
