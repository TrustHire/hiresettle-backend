import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Observable, of } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Global interceptor that adds ETag headers to GET responses and
 * short-circuits with 304 Not Modified when the request's
 * If-None-Match header matches the computed ETag.
 *
 * Applies to all GET endpoints (detail and list) since it is
 * registered globally in main.ts.
 */
@Injectable()
export class EtagInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    const request = http.getRequest();
    const response = http.getResponse();

    if (request.method !== 'GET') {
      return next.handle();
    }

    return next.handle().pipe(
      map((body) => {
        const etag = this.computeEtag(body);
        response.setHeader('ETag', etag);

        const ifNoneMatch = request.headers['if-none-match'];
        if (ifNoneMatch && this.matches(ifNoneMatch, etag)) {
          response.status(304);
          return undefined;
        }

        return body;
      }),
    );
  }

  private computeEtag(body: unknown): string {
    const serialized = JSON.stringify(body ?? null);
    const hash = createHash('sha1').update(serialized).digest('hex');
    return `"${hash}"`;
  }

  private matches(ifNoneMatch: string, etag: string): boolean {
    const candidates = ifNoneMatch.split(',').map((value) => value.trim());
    return candidates.some((candidate) => candidate === etag || candidate === '*');
  }
}
