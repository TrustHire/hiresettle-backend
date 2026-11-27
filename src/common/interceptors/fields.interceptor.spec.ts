import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { lastValueFrom, of } from 'rxjs';
import {
  FieldsInterceptor,
  SPARSE_FIELDS_KEY,
  SparseFields,
} from './fields.interceptor';

function createMockContext(query?: Record<string, unknown>) {
  const handler = jest.fn();
  class DummyController {}

  const context = {
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: () => ({ query }),
    }),
    getHandler: jest.fn().mockReturnValue(handler),
    getClass: jest.fn().mockReturnValue(DummyController),
  } as unknown as ExecutionContext;

  return { context, handler, controllerClass: DummyController };
}

describe('SparseFields decorator', () => {
  it('sets metadata on a method descriptor', () => {
    class TestController {
      @SparseFields('id', 'status')
      findAll() {
        return [];
      }
    }

    const metadata = Reflect.getMetadata(
      SPARSE_FIELDS_KEY,
      TestController.prototype.findAll,
    );
    expect(metadata).toEqual(['id', 'status']);
  });

  it('sets metadata on a class', () => {
    @SparseFields('id', 'jobTitle')
    class TestController {}

    const metadata = Reflect.getMetadata(SPARSE_FIELDS_KEY, TestController);
    expect(metadata).toEqual(['id', 'jobTitle']);
  });
});

describe('FieldsInterceptor', () => {
  let reflector: jest.Mocked<Reflector>;
  let interceptor: FieldsInterceptor;

  beforeEach(() => {
    reflector = {
      get: jest.fn(),
    } as unknown as jest.Mocked<Reflector>;
    interceptor = new FieldsInterceptor(reflector);
  });

  describe('when fields query parameter is absent or empty', () => {
    it.each([undefined, null, ''])(
      'passes through untouched when fields is %p',
      async (fields) => {
        const { context } = createMockContext({ fields });
        const payload = { id: '1', status: 'ACTIVE', secret: 'hidden' };
        const next: CallHandler = { handle: () => of(payload) };

        const result = await lastValueFrom(interceptor.intercept(context, next));

        expect(result).toEqual(payload);
        expect(reflector.get).not.toHaveBeenCalled();
      },
    );

    it('passes through untouched when query object is undefined', async () => {
      const { context } = createMockContext(undefined);
      const payload = [{ id: '1', status: 'ACTIVE' }];
      const next: CallHandler = { handle: () => of(payload) };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual(payload);
      expect(reflector.get).not.toHaveBeenCalled();
    });
  });

  describe('validation and parsing', () => {
    it('throws BadRequestException when fields contains only whitespace or commas', () => {
      const { context } = createMockContext({ fields: ' ,  , ' });
      const next: CallHandler = { handle: () => of({}) };

      expect(() => interceptor.intercept(context, next)).toThrow(
        new BadRequestException('The `fields` query parameter must not be empty'),
      );
    });

    it('rejects unknown fields when allowed fields are declared on the handler', () => {
      const { context, handler } = createMockContext({
        fields: 'id,unknownField,anotherBad',
      });
      reflector.get.mockImplementation((key, target) =>
        key === SPARSE_FIELDS_KEY && target === handler
          ? ['id', 'status', 'jobTitle']
          : undefined,
      );
      const next: CallHandler = { handle: () => of({}) };

      expect(() => interceptor.intercept(context, next)).toThrow(
        new BadRequestException(
          'Unknown field(s): unknownField, anotherBad. Allowed fields: id, status, jobTitle',
        ),
      );
    });

    it('falls back to class-level allowed fields when handler has no metadata', () => {
      const { context, controllerClass } = createMockContext({
        fields: 'id,forbidden',
      });
      reflector.get.mockImplementation((key, target) =>
        key === SPARSE_FIELDS_KEY && target === controllerClass
          ? ['id', 'status']
          : undefined,
      );
      const next: CallHandler = { handle: () => of({}) };

      expect(() => interceptor.intercept(context, next)).toThrow(
        new BadRequestException(
          'Unknown field(s): forbidden. Allowed fields: id, status',
        ),
      );
    });

    it('prefers handler-level allowed fields over class-level allowed fields', async () => {
      const { context, handler, controllerClass } = createMockContext({
        fields: 'id,onlyOnHandler',
      });
      reflector.get.mockImplementation((key, target) => {
        if (key !== SPARSE_FIELDS_KEY) return undefined;
        if (target === handler) return ['id', 'onlyOnHandler'];
        if (target === controllerClass) return ['id', 'status'];
        return undefined;
      });
      const next: CallHandler = {
        handle: () => of({ id: '1', onlyOnHandler: true, status: 'ACTIVE' }),
      };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual({ id: '1', onlyOnHandler: true });
    });

    it('parses array query parameters, trims whitespace, and deduplicates fields', async () => {
      const { context } = createMockContext({
        fields: [' id , status ', 'status, jobTitle'],
      });
      reflector.get.mockReturnValue(undefined);
      const next: CallHandler = {
        handle: () =>
          of({ id: '1', status: 'ACTIVE', jobTitle: 'Dev', extra: 'drop' }),
      };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual({ id: '1', status: 'ACTIVE', jobTitle: 'Dev' });
    });
  });

  describe('projection behavior', () => {
    beforeEach(() => {
      reflector.get.mockReturnValue(undefined);
    });

    it('projects a single object and preserves nested object values', async () => {
      const { context } = createMockContext({ fields: 'id,client,missing' });
      const payload = {
        id: 'eng-1',
        status: 'ACTIVE',
        client: { id: 'cli-1', name: 'Acme Corp' },
      };
      const next: CallHandler = { handle: () => of(payload) };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual({
        id: 'eng-1',
        client: { id: 'cli-1', name: 'Acme Corp' },
      });
      expect('missing' in (result as Record<string, unknown>)).toBe(false);
    });

    it('projects an array of objects', async () => {
      const { context } = createMockContext({ fields: 'id,status' });
      const payload = [
        { id: '1', status: 'ACTIVE', rate: 100 },
        { id: '2', status: 'PAUSED', rate: 200 },
      ];
      const next: CallHandler = { handle: () => of(payload) };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual([
        { id: '1', status: 'ACTIVE' },
        { id: '2', status: 'PAUSED' },
      ]);
    });

    it('projects enveloped list responses while preserving envelope metadata', async () => {
      const { context } = createMockContext({ fields: 'id,jobTitle' });
      const payload = {
        data: [
          { id: '1', jobTitle: 'Engineer', salary: 100000 },
          { id: '2', jobTitle: 'Designer', salary: 90000 },
        ],
        meta: { total: 2, page: 1 },
      };
      const next: CallHandler = { handle: () => of(payload) };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual({
        data: [
          { id: '1', jobTitle: 'Engineer' },
          { id: '2', jobTitle: 'Designer' },
        ],
        meta: { total: 2, page: 1 },
      });
    });

    it('projects enveloped single-object responses', async () => {
      const { context } = createMockContext({ fields: 'id' });
      const payload = {
        data: { id: '1', status: 'ACTIVE' },
        requestId: 'req-123',
      };
      const next: CallHandler = { handle: () => of(payload) };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual({
        data: { id: '1' },
        requestId: 'req-123',
      });
    });

    it('returns primitive and null values as-is', async () => {
      const { context } = createMockContext({ fields: 'id' });

      const nullResult = await lastValueFrom(
        interceptor.intercept(context, { handle: () => of(null) }),
      );
      const stringResult = await lastValueFrom(
        interceptor.intercept(context, { handle: () => of('plain-text') }),
      );
      const mixedArrayResult = await lastValueFrom(
        interceptor.intercept(context, {
          handle: () => of([null, 'text', { id: '1', extra: true }]),
        }),
      );

      expect(nullResult).toBeNull();
      expect(stringResult).toBe('plain-text');
      expect(mixedArrayResult).toEqual([null, 'text', { id: '1' }]);
    });
  });
});
