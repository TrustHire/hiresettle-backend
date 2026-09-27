import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min, Validate } from 'class-validator';
import { ValidatorConstraint, ValidatorConstraintInterface, ValidationArguments } from 'class-validator';

/**
 * Allowed field names for sparse fieldsets on list endpoints.
 * Extend this list as new listable fields are introduced.
 */
export const ALLOWED_FIELDS = [
  'id',
  'status',
  'jobTitle',
  'createdAt',
  'updatedAt',
] as const;

export type AllowedField = (typeof ALLOWED_FIELDS)[number];

@ValidatorConstraint({ name: 'isAllowedFields', async: false })
export class IsAllowedFieldsConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null || value === '') {
      return true;
    }
    if (typeof value !== 'string') {
      return false;
    }
    const requested = value
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    if (requested.length === 0) {
      return false;
    }
    return requested.every((field) =>
      (ALLOWED_FIELDS as readonly string[]).includes(field),
    );
  }

  defaultMessage(args: ValidationArguments): string {
    const value = args.value as string;
    const requested = String(value)
      .split(',')
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
    const unknown = requested.filter(
      (field) => !(ALLOWED_FIELDS as readonly string[]).includes(field),
    );
    return `Unknown field(s): ${unknown.join(', ')}. Allowed fields: ${ALLOWED_FIELDS.join(', ')}`;
  }
}

/**
 * Parses a `fields` query parameter into a normalized list of field names.
 * Returns `undefined` when no fields were requested (full objects).
 */
export function parseFields(fields?: string): string[] | undefined {
  if (!fields) {
    return undefined;
  }
  const parsed = fields
    .split(',')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  return parsed.length > 0 ? parsed : undefined;
}

/**
 * Picks only the requested fields from an object. When `fields` is undefined
 * the original object is returned unchanged.
 */
export function applyFields<T extends Record<string, unknown>>(
  item: T,
  fields?: string[],
): Partial<T> {
  if (!fields || fields.length === 0) {
    return item;
  }
  const result: Partial<T> = {};
  for (const field of fields) {
    if (field in item) {
      result[field as keyof T] = item[field as keyof T];
    }
  }
  return result;
}

export class PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Page number (1-based)',
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({
    description: 'Number of items per page',
    minimum: 1,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Comma-separated list of fields to include in each returned object (sparse fieldsets). Unknown fields are rejected with 400.',
    example: 'id,status,jobTitle',
  })
  @IsOptional()
  @IsString()
  @Validate(IsAllowedFieldsConstraint)
  fields?: string;
}
