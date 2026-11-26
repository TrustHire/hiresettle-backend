import { CallHandler, ExecutionContext } from '@nestjs/common';
import { createHash } from 'crypto';
import { lastValueFrom, of } from 'rxjs';
import { EtagInterceptor } from './etag.interceptor';

function expectedEtag(body: unknown): string {
  const serialized = JSON.stringify(body ?? null);
  const hash = createHash('sha1').update(serialized).digest('hex');
  return `"${hash}"`;
}

function createMockContext(options: {
  type?: string;
  method?: string;
  headers?: Record<string, string | undefined>;
}) {
  const setHeader = jest.fn();
  const status = jest.fn();
  const request = {
    method: options.method ?? 'GET',
    headers: options.headers ?? {},
  };
  const response = {
    setHeader,
    status,
  };

  const context = {
    getType: jest.fn().mockReturnValue(options.type ?? 'http'),
    switchToHttp: jest.fn().mockReturnValue({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;

  return { context, request, response, setHeader, status };
}

describe('EtagInterceptor', () => {
  let interceptor: EtagInterceptor;

  beforeEach(() => {
    interceptor = new EtagInterceptor();
  });

  it('passes through non-HTTP contexts without setting headers', async () => {
    const { context, setHeader, status } = createMockContext({ type: 'graphql' });
    const payload = { id: '1' };
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual(payload);
    expect(setHeader).not.toHaveBeenCalled();
    expect(status).not.toHaveBeenCalled();
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'passes through non-GET (%s) requests without computing ETag',
    async (method) => {
      const { context, setHeader, status } = createMockContext({ method });
      const payload = { created: true };
      const next: CallHandler = { handle: () => of(payload) };

      const result = await lastValueFrom(interceptor.intercept(context, next));

      expect(result).toEqual(payload);
      expect(setHeader).not.toHaveBeenCalled();
      expect(status).not.toHaveBeenCalled();
    },
  );

  it('sets ETag header and returns body on GET when If-None-Match is absent', async () => {
    const { context, setHeader, status } = createMockContext({ method: 'GET' });
    const payload = { id: 'eng-1', status: 'ACTIVE' };
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual(payload);
    expect(setHeader).toHaveBeenCalledWith('ETag', expectedEtag(payload));
    expect(status).not.toHaveBeenCalled();
  });

  it('handles null and undefined response bodies consistently', async () => {
    const { context: nullCtx, setHeader: setHeaderNull } = createMockContext({
      method: 'GET',
    });
    const { context: undefCtx, setHeader: setHeaderUndef } = createMockContext({
      method: 'GET',
    });

    const nullResult = await lastValueFrom(
      interceptor.intercept(nullCtx, { handle: () => of(null) }),
    );
    const undefResult = await lastValueFrom(
      interceptor.intercept(undefCtx, { handle: () => of(undefined) }),
    );

    expect(nullResult).toBeNull();
    expect(undefResult).toBeUndefined();
    expect(setHeaderNull).toHaveBeenCalledWith('ETag', expectedEtag(null));
    expect(setHeaderUndef).toHaveBeenCalledWith('ETag', expectedEtag(null));
  });

  it('returns 304 Not Modified and undefined body when If-None-Match matches exactly', async () => {
    const payload = { id: 'eng-1', title: 'Engineer' };
    const etag = expectedEtag(payload);
    const { context, setHeader, status } = createMockContext({
      method: 'GET',
      headers: { 'if-none-match': etag },
    });
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toBeUndefined();
    expect(setHeader).toHaveBeenCalledWith('ETag', etag);
    expect(status).toHaveBeenCalledWith(304);
  });

  it('returns 304 Not Modified when If-None-Match is wildcard (*)', async () => {
    const payload = { items: [1, 2, 3] };
    const { context, setHeader, status } = createMockContext({
      method: 'GET',
      headers: { 'if-none-match': '*' },
    });
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toBeUndefined();
    expect(setHeader).toHaveBeenCalledWith('ETag', expectedEtag(payload));
    expect(status).toHaveBeenCalledWith(304);
  });

  it('returns 304 Not Modified when If-None-Match contains a comma-separated list with a match', async () => {
    const payload = { id: 'eng-2' };
    const etag = expectedEtag(payload);
    const { context, setHeader, status } = createMockContext({
      method: 'GET',
      headers: { 'if-none-match': `"stale-etag",  ${etag} , "another"` },
    });
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toBeUndefined();
    expect(setHeader).toHaveBeenCalledWith('ETag', etag);
    expect(status).toHaveBeenCalledWith(304);
  });

  it('returns full body when If-None-Match does not match computed ETag', async () => {
    const payload = { id: 'eng-3' };
    const { context, setHeader, status } = createMockContext({
      method: 'GET',
      headers: { 'if-none-match': '"different-etag"' },
    });
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual(payload);
    expect(setHeader).toHaveBeenCalledWith('ETag', expectedEtag(payload));
    expect(status).not.toHaveBeenCalled();
  });

  it('does not treat a weak ETag (W/...) as matching a strong ETag', async () => {
    const payload = { id: 'eng-4' };
    const strongEtag = expectedEtag(payload);
    const { context, setHeader, status } = createMockContext({
      method: 'GET',
      headers: { 'if-none-match': `W/${strongEtag}` },
    });
    const next: CallHandler = { handle: () => of(payload) };

    const result = await lastValueFrom(interceptor.intercept(context, next));

    expect(result).toEqual(payload);
    expect(setHeader).toHaveBeenCalledWith('ETag', strongEtag);
    expect(status).not.toHaveBeenCalled();
  });
});
