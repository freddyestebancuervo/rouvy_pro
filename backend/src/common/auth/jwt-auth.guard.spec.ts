import { ExecutionContext } from '@nestjs/common';
import { AccessTokenClaims, TokenService } from '../../jwt/token.service';
import { JwtAuthGuard } from './jwt-auth.guard';

function buildContext(headers: Record<string, string | undefined>): {
  context: ExecutionContext;
  req: { headers: Record<string, string | undefined>; user?: unknown };
} {
  const req: { headers: Record<string, string | undefined>; user?: unknown } = { headers };
  const context = {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('JwtAuthGuard', () => {
  const claims: AccessTokenClaims = { userId: 'user-1', roles: ['user'], emailVerified: true };

  function buildGuard(verifyAccessToken: jest.Mock) {
    const tokenService = { verifyAccessToken } as unknown as TokenService;
    return new JwtAuthGuard(tokenService);
  }

  it('rechaza si no hay header Authorization', () => {
    const guard = buildGuard(jest.fn());
    const { context } = buildContext({});

    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_MISSING_OR_INVALID' }),
    );
  });

  it('rechaza si el header no usa el esquema Bearer', () => {
    const guard = buildGuard(jest.fn());
    const { context } = buildContext({ authorization: 'Basic abc123' });

    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_MISSING_OR_INVALID' }),
    );
  });

  it('rechaza si TokenService.verifyAccessToken lanza (firma inválida/expirado)', () => {
    const verifyAccessToken = jest.fn().mockImplementation(() => {
      throw new Error('jwt expired');
    });
    const guard = buildGuard(verifyAccessToken);
    const { context } = buildContext({ authorization: 'Bearer some.jwt.token' });

    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ code: 'AUTH_TOKEN_MISSING_OR_INVALID' }),
    );
  });

  it('con un token válido, cuelga los claims en req.user y permite pasar', () => {
    const verifyAccessToken = jest.fn().mockReturnValue(claims);
    const guard = buildGuard(verifyAccessToken);
    const { context, req } = buildContext({ authorization: 'Bearer valid.jwt.token' });

    expect(guard.canActivate(context)).toBe(true);
    expect(verifyAccessToken).toHaveBeenCalledWith('valid.jwt.token');
    expect(req.user).toEqual(claims);
  });
});
