import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { TokenService } from '../../jwt/token.service';
import { ApiException } from '../exceptions/api.exception';
import { AuthenticatedRequest } from './auth-user.interface';

const AUTH_TOKEN_INVALID = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'AUTH_TOKEN_MISSING_OR_INVALID',
    'Falta el token de acceso o no es válido.',
  );

/**
 * Protege las rutas `Auth: Bearer` de la spec (sección 1.2 — `/users/me`
 * hoy; cualquier endpoint futuro que lo necesite, ej. D1). Verifica firma
 * RS256 + `iss`/`aud` (`TokenService.verifyAccessToken`, sección 5.1) y
 * cuelga el usuario resuelto en `req.user` para que `@CurrentUser()` lo
 * lea sin volver a tocar el header.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw AUTH_TOKEN_INVALID();
    }

    const token = header.slice('Bearer '.length).trim();
    try {
      const claims = this.tokenService.verifyAccessToken(token);
      (req as AuthenticatedRequest).user = claims;
      return true;
    } catch {
      throw AUTH_TOKEN_INVALID();
    }
  }
}
