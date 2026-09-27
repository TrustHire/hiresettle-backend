import {
  ArgumentMetadata,
  BadRequestException,
  Injectable,
  PipeTransform,
} from '@nestjs/common';

/**
 * Parses and validates a `fields` query parameter for sparse fieldsets.
 *
 * Usage: `?fields=id,status,jobTitle`
 *
 * The pipe is configured with the set of fields that are allowed for the
 * endpoint it is applied to. Unknown fields are rejected with HTTP 400 so
 * clients get immediate feedback instead of silently receiving full objects.
 *
 * The parsed result is a de-duplicated array of allowed field names, or
 * `undefined` when the parameter is absent (meaning: return full objects).
 */
@Injectable()
export class ParseFieldsPipe implements PipeTransform<string | undefined, string[] | undefined> {
  constructor(private readonly allowedFields: readonly string[]) {}

  transform(value: string | undefined, _metadata: ArgumentMetadata): string[] | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new BadRequestException('`fields` must be a comma-separated list of field names');
    }

    const requested = value
      .split(',')
      .map((field) => field.trim())
      .filter((field) => field.length > 0);

    if (requested.length === 0) {
      throw new BadRequestException('`fields` must contain at least one field name');
    }

    const allowed = new Set(this.allowedFields);
    const unknown = requested.filter((field) => !allowed.has(field));

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown field(s): ${unknown.join(', ')}. Allowed fields: ${this.allowedFields.join(', ')}`,
      );
    }

    return Array.from(new Set(requested));
  }
}
