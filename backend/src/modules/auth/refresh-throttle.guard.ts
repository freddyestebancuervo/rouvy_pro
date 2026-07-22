import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import { Request } from 'express';

const TTL_MS = 15 * 60 * 1000;
const LIMIT = 20;
const THROTTLER_NAME = 'auth-refresh';

/**
 * Rate limit dedicado a `POST /auth/refresh`: "20 req / 15 min / TOKEN"
 * (spec sección 1.2) — por token, no por IP, porque el refresh token ES
 * la credencial. No se modela como un segundo bucket nombrado en
 * `ThrottlerModule.forRoot()` (ver el comentario en `app.module.ts`);
 * en cambio, reutiliza directamente el mismo `ThrottlerStorage` que usa
 * `ThrottlerGuard` para todo lo demás (mismo backend en memoria hoy,
 * intercambiable por Redis en producción sin tocar este guard) llamando
 * a `increment()` con una clave propia, acotada a esta única ruta.
 */
@Injectable()
export class RefreshThrottleGuard implements CanActivate {
  constructor(@InjectThrottlerStorage() private readonly storage: ThrottlerStorage) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const token = (req.body as { refreshToken?: string } | undefined)?.refreshToken ?? req.ip ?? 'unknown';
    const key = `${THROTTLER_NAME}:${token}`;

    const { isBlocked } = await this.storage.increment(key, TTL_MS, LIMIT, TTL_MS, THROTTLER_NAME);
    if (isBlocked) {
      throw new HttpException('Demasiadas solicitudes de refresh.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
