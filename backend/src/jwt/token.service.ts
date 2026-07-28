import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import * as jwt from 'jsonwebtoken';

export interface AccessTokenClaims {
  userId: string;
  roles: string[];
  emailVerified: boolean;
  /** Presente únicamente para usuarios vinculados vía
   * `/auth/firebase/exchange` (Fase 3) — `undefined` para sesiones
   * emitidas por `/auth/register`/`/auth/login` (password directo) o por
   * la cuenta QA. Claim aditivo: no reemplaza `sub` (que sigue siendo
   * siempre el `id` de Postgres, nunca el uid de Firebase). */
  firebaseUid?: string;
}

/**
 * Firma y verifica el JWT propio del backend siguiendo exactamente la
 * spec sección 5.1 (claims, RS256, `iss`/`aud`), y emite el refresh token
 * opaco que `RefreshTokensRepository` persiste. Las claves se leen una
 * sola vez al arrancar desde `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH`
 * (ver `.env.example`) — nunca hardcodeadas, mismo principio de secretos
 * ya aplicado en el resto del proyecto.
 *
 * Vive en `src/jwt/` (módulo global, ver `jwt.module.ts`) en vez de
 * `modules/auth/` porque tanto `AuthModule` (firma) como `UsersModule`
 * (verifica, en `JwtAuthGuard`) lo necesitan — dejarlo dentro de
 * `AuthModule` hubiera obligado a un import circular entre ambos módulos
 * (`AuthModule` ya importa `UsersModule` para `UsersRepository`).
 */
@Injectable()
export class TokenService implements OnModuleInit {
  private privateKey!: string;
  private publicKey!: string;
  private accessTokenTtlSeconds!: number;
  private issuer!: string;
  private audience!: string;
  private refreshTokenTtlDays!: number;

  onModuleInit(): void {
    const privateKeyPath = process.env.JWT_PRIVATE_KEY_PATH;
    const publicKeyPath = process.env.JWT_PUBLIC_KEY_PATH;
    if (!privateKeyPath || !publicKeyPath) {
      throw new Error(
        'JWT_PRIVATE_KEY_PATH/JWT_PUBLIC_KEY_PATH no están definidas — ver .env.example.',
      );
    }
    this.privateKey = readFileSync(privateKeyPath, 'utf8');
    this.publicKey = readFileSync(publicKeyPath, 'utf8');
    this.accessTokenTtlSeconds = Number(process.env.JWT_ACCESS_TOKEN_TTL_SECONDS ?? 3600);
    this.issuer = process.env.JWT_ISSUER ?? 'https://api.ridepro.app';
    this.audience = process.env.JWT_AUDIENCE ?? 'ridepro-mobile';
    // No especificado en la spec (solo fija el TTL del access token) —
    // 30 días es un default razonable para un refresh token de app móvil,
    // documentado aquí como decisión, no un requisito literal del contrato.
    this.refreshTokenTtlDays = Number(process.env.JWT_REFRESH_TOKEN_TTL_DAYS ?? 30);
  }

  signAccessToken(params: {
    userId: string;
    roles: string[];
    emailVerified: boolean;
    firebaseUid?: string;
  }): string {
    return jwt.sign(
      {
        roles: params.roles,
        email_verified: params.emailVerified,
        ...(params.firebaseUid ? { firebaseUid: params.firebaseUid } : {}),
      },
      this.privateKey,
      {
        algorithm: 'RS256',
        subject: params.userId,
        issuer: this.issuer,
        audience: this.audience,
        expiresIn: this.accessTokenTtlSeconds,
      },
    );
  }

  /** @throws {jwt.JsonWebTokenError | jwt.TokenExpiredError} si la firma,
   * el emisor, la audiencia o la expiración no son válidos — `JwtAuthGuard`
   * es quien traduce eso a `401`, no este servicio (que se mantiene
   * agnóstico de HTTP). */
  verifyAccessToken(token: string): AccessTokenClaims {
    const payload = jwt.verify(token, this.publicKey, {
      algorithms: ['RS256'],
      issuer: this.issuer,
      audience: this.audience,
    });
    if (typeof payload === 'string' || !payload.sub) {
      throw new jwt.JsonWebTokenError('Token sin subject.');
    }
    return {
      userId: payload.sub,
      roles: Array.isArray(payload.roles) ? (payload.roles as string[]) : [],
      emailVerified: Boolean(payload.email_verified),
      ...(typeof payload.firebaseUid === 'string' ? { firebaseUid: payload.firebaseUid } : {}),
    };
  }

  issueRefreshToken(): { token: string; hash: string; expiresAt: Date } {
    const token = `rt_${randomBytes(32).toString('hex')}`;
    const hash = this.hashRefreshToken(token);
    const expiresAt = new Date(Date.now() + this.refreshTokenTtlDays * 24 * 60 * 60 * 1000);
    return { token, hash, expiresAt };
  }

  /** Mismo hash que persiste `refresh_tokens.token_hash` — nunca se
   * guarda el token en texto plano, siguiendo el patrón ya usado para
   * `password_hash` (gestión de secretos, spec sección 5.5). */
  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  get accessTokenExpiresIn(): number {
    return this.accessTokenTtlSeconds;
  }
}
