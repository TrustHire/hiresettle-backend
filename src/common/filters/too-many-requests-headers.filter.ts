import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpStatus,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

@Catch(ThrottlerException)
export class TooManyRequestsHeadersFilter implements ExceptionFilter {
    catch(exception: ThrottlerException, host: ArgumentsHost) {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<Response>();
        const request = ctx.getRequest<Request>();

        // Ensure required headers are present.
        // Prefer any existing values (e.g. from @nestjs/throttler), otherwise set ours.
        if (!response.getHeader('Retry-After')) {
            response.setHeader('Retry-After', '60');
        }

        if (!response.getHeader('X-RateLimit-Reset')) {
            const resetAt = Math.floor(Date.now() / 1000) + 60; // unix seconds
            response.setHeader('X-RateLimit-Reset', String(resetAt));
        }

        response.status(HttpStatus.TOO_MANY_REQUESTS).json({
            success: false,
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            timestamp: new Date().toISOString(),
            path: request.url,
            message: exception.getResponse(),
        });
    }
}

