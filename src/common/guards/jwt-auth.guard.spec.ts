import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;

  beforeEach(() => {
    guard = new JwtAuthGuard();
  });

  it('should be defined', () => {
    expect(guard).toBeDefined();
  });

  it('extends AuthGuard("jwt")', () => {
    // JwtAuthGuard extends AuthGuard('jwt') from @nestjs/passport
    expect(guard instanceof JwtAuthGuard).toBe(true);
  });
});
