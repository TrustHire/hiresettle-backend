import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';

/**
 * Metadata key used to declare the set of fields a controller/handler
 * exposes for sparse fieldsets via the `fields` query parameter.
 */
export const SPARSE_FIELDS_KEY = 'sparse_fields';

/**
 * Declares the allowed fields for sparse fieldsets on a controller or handler.
 *
 * @example
 * ```ts
 * @SparseFields(['id', 'status', 'jobTitle'])
 * @Get()
 * findAll() { ... }
 * ```
 */
export const SparseFields = (...fields: string[]): MethodDecorator & ClassDecorator =>
  (target: object, key?: string | symbol, descriptor?: PropertyDescriptor) => {
    if (descriptor) {
      Reflect.defineMetadata(SPARSE_FIELDS_KEY, fields, descriptor.value);
    } else {
      Reflect.defineMetadata(SPARSE_FIELDS_KEY, fields, target);
    }
  };

/**
 * Parses and validates the `fields` query parameter once, so every list
 * endpoint can reuse the same sparse fieldset behaviour.
 *
 * - `?fields=id,status,jobTitle` returns only the requested fields.
 * - Unknown fields are rejected with HTTP 400.
 * - When `fields` is omitted the payload is returned untouched.
 */
@Injectable()
export class FieldsInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    const rawFields: unknown = request?.query?.fields;

    if (rawFields === undefined || rawFields === null || rawFields === '') {
      return next.handle();
    }

    const allowed = this.getAllowedFields(context);
    const requested = this.parseFields(rawFields);

    if (allowed.length > 0) {
      const unknown = requested.filter((field) => !allowed.includes(field));
      if (unknown.length > 0) {
        throw new BadRequestException(
          `Unknown field(s): ${unknown.join(', ')}. Allowed fields: ${allowed.join(', ')}`,
        );
      }
    }

    return next.handle().pipe(map((data) => this.applyFields(data, requested)));
  }

  private getAllowedFields(context: ExecutionContext): string[] {
    const fromHandler = this.reflector.get<string[] | undefined>(
      SPARSE_FIELDS_KEY,
      context.getHandler(),
    );
    if (fromHandler) {
      return fromHandler;
    }

    const fromClass = this.reflector.get<string[] | undefined>(
      SPARSE_FIELDS_KEY,
      context.getClass(),
    );
    return fromClass ?? [];
  }

  private parseFields(rawFields: unknown): string[] {
    const values = Array.isArray(rawFields) ? rawFields : [rawFields];
    const fields = values
      .flatMap((value) => String(value).split(','))
      .map((field) => field.trim())
      .filter((field) => field.length > 0);

    if (fields.length === 0) {
      throw new BadRequestException('The `fields` query parameter must not be empty');
    }

    return Array.from(new Set(fields));
  }

  private applyFields(data: unknown, fields: string[]): unknown {
    if (Array.isArray(data)) {
      return data.map((item) => this.pick(item, fields));
    }

    if (data && typeof data === 'object' && 'data' in (data as Record<string, unknown>)) {
      const envelope = data as Record<string, unknown>;
      return { ...envelope, data: this.applyFields(envelope.data, fields) };
    }

    return this.pick(data, fields);
  }

  private pick(item: unknown, fields: string[]): unknown {
    if (!item || typeof item !== 'object') {
      return item;
    }

    const source = item as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const field of fields) {
      if (field in source) {
        result[field] = source[field];
      }
    }
    return result;
  }
}
