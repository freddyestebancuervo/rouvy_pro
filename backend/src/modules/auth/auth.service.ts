import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectThrottlerStorage, ThrottlerStorage } from '@nestjs/throttler';
import * as bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { isPgUniqueViolation } from '../../common/database/pg-error.util';
import { ApiException } from '../../common/exceptions/api.exception';
import { FirebaseTokenVerifierService } from '../../firebase/firebase-token-verifier.service';
import {
  FirebaseProjectMismatchError,
  FirebaseTokenExpiredError,
  FirebaseTokenInvalidError,
  FirebaseTokenRevokedError,
} from '../../firebase/errors/firebase-verification.errors';
import { TokenService } from '../../jwt/token.service';
import { RefreshTokensRepository } from '../refresh-tokens/refresh-tokens.repository';
import { FirebaseEmailConflictError } from '../users/errors/firebase-email-conflict.error';
import { FirebaseBackedAuthProvider, UserRecord, UsersRepository } from '../users/users.repository';
import { AuditLogRepository } from './audit-log.repository';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import {
  FIREBASE_EMAIL_CONFLICT,
  FIREBASE_EMAIL_NOT_VERIFIED,
  FIREBASE_EXCHANGE_RATE_LIMITED,
  FIREBASE_PROJECT_MISMATCH,
  FIREBASE_TOKEN_EXPIRED,
  FIREBASE_TOKEN_INVALID,
  FIREBASE_TOKEN_REVOKED,
} from './firebase-exchange.errors';

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;

// Capa 2 (Fase 4.2 Parte 2) — por identidad real (Firebase UID), la
// protección "de verdad": ni compartir IP ni rotar de red la elude.
// Clave hasheada (SHA-256) a propósito — nunca se guarda ni loguea el
// `firebase_uid` completo (mismo criterio que `AuditLogRepository`).
const FIREBASE_EXCHANGE_UID_THROTTLER_NAME = 'firebase-exchange-uid';
const FIREBASE_EXCHANGE_UID_LIMIT = 20;

// Capa 3 (Fase 4.2 Parte 2) — respaldo por IP para tráfico YA verificado
// (distinto del bucket de Capa 1 en el controller, que cubre tokens
// inválidos/no verificados): mucho más generoso porque una IP compartida
// (universidad, gimnasio, CGNAT) puede legítimamente traer decenas de
// identidades distintas.
const FIREBASE_EXCHANGE_IP_VERIFIED_THROTTLER_NAME = 'firebase-exchange-ip-verified';
const FIREBASE_EXCHANGE_IP_VERIFIED_LIMIT = 100;

function hashForRateLimitKey(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

const BCRYPT_ROUNDS = 12;

export interface AuthResponse {
  userId: string;
  email: string;
  emailVerified: boolean;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

const REFRESH_TOKEN_INVALID_OR_REUSED = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'REFRESH_TOKEN_INVALID_OR_REUSED',
    'El refresh token no es válido, expiró o ya fue usado.',
  );

// Mismo código/mensaje sin importar si el email no existe o la
// contraseña no matchea — evita enumeración de cuentas (spec 5.5), mismo
// principio que `password-reset/request` (siempre 202).
const AUTH_INVALID_CREDENTIALS = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'AUTH_INVALID_CREDENTIALS',
    'Correo o contraseña incorrectos.',
  );

const EMAIL_ALREADY_EXISTS = (): ApiException =>
  new ApiException(
    HttpStatus.CONFLICT,
    'EMAIL_ALREADY_EXISTS',
    'Ya existe una cuenta con ese correo.',
  );

/**
 * Mapea `firebase.sign_in_provider` (tal como lo manda Firebase:
 * `password` | `google.com` | `apple.com` | ...) al valor esperado por el
 * `CHECK` de `auth_provider` (migración 0001). Cualquier proveedor no
 * contemplado cae en `password` — no porque lo sea, sino porque es el
 * valor más neutro del `CHECK` existente; no se amplía esa constraint en
 * esta fase (fuera de alcance, la app hoy solo ofrece los 3 de siempre).
 */
function normalizeFirebaseProvider(signInProvider: string | null): FirebaseBackedAuthProvider {
  if (signInProvider === 'google.com') return 'google';
  if (signInProvider === 'apple.com') return 'apple';
  return 'password';
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersRepository: UsersRepository,
    private readonly refreshTokensRepository: RefreshTokensRepository,
    private readonly tokenService: TokenService,
    private readonly firebaseTokenVerifier: FirebaseTokenVerifierService,
    private readonly auditLogRepository: AuditLogRepository,
    @InjectThrottlerStorage() private readonly throttlerStorage: ThrottlerStorage,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResponse> {
    const existing = await this.usersRepository.findByEmail(dto.email);
    if (existing) {
      throw EMAIL_ALREADY_EXISTS();
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let user: UserRecord;
    try {
      user = await this.usersRepository.createWithPassword({
        email: dto.email,
        passwordHash,
        displayName: dto.displayName,
      });
    } catch (error) {
      // El chequeo de arriba tiene una ventana de carrera real: dos
      // registros concurrentes con el mismo email en distinto case
      // ("Rider@x.com"/"rider@x.com") pueden pasar ambos el `findByEmail`
      // antes de que cualquiera haya insertado — el índice único
      // `users_email_lower_unique` (migración 0002) es quien realmente
      // cierra la carrera; acá solo se traduce su `23505` al mismo error
      // de contrato que el chequeo rápido de arriba.
      if (isPgUniqueViolation(error)) {
        throw EMAIL_ALREADY_EXISTS();
      }
      throw error;
    }

    return this.issueSession(user.id, user.email, user.emailVerified, ['user']);
  }

  async login(dto: LoginDto): Promise<AuthResponse> {
    const user = await this.usersRepository.findByEmail(dto.email);

    if (!user || !user.passwordHash) {
      throw AUTH_INVALID_CREDENTIALS();
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw AUTH_INVALID_CREDENTIALS();
    }

    const roles = await this.usersRepository.findRoleNames(user.id);
    return this.issueSession(user.id, user.email, user.emailVerified, roles);
  }

  /**
   * `POST /auth/refresh` — spec sección 5.2. Genera el token nuevo ANTES
   * de intentar la rotación (operación local, sin costo si se descarta) y
   * delega toda la decisión atómica (rotar / detectar reuso / expirado /
   * no encontrado) a `RefreshTokensRepository.rotate`, que corre en una
   * única transacción con row lock — ver el docblock de ese método para
   * el razonamiento de concurrencia.
   */
  async refresh(dto: RefreshDto): Promise<RefreshResponse> {
    const oldTokenHash = this.tokenService.hashRefreshToken(dto.refreshToken);
    const newRefresh = this.tokenService.issueRefreshToken();

    const outcome = await this.refreshTokensRepository.rotate({
      oldTokenHash,
      newTokenHash: newRefresh.hash,
      newExpiresAt: newRefresh.expiresAt,
    });

    if (outcome.status === 'not_found' || outcome.status === 'expired') {
      throw REFRESH_TOKEN_INVALID_OR_REUSED();
    }

    if (outcome.status === 'reused') {
      this.logger.warn(
        `Refresh token reuse detectado para user_id=${outcome.userId} — todos sus refresh tokens activos fueron revocados.`,
      );
      throw REFRESH_TOKEN_INVALID_OR_REUSED();
    }

    const user = await this.usersRepository.findById(outcome.userId);
    if (!user) {
      // El usuario fue borrado entre el lock y esta lectura (soft delete
      // concurrente) — mismo código genérico, no hay nada más específico
      // que comunicarle a un cliente con un refresh token de una cuenta
      // que ya no existe.
      throw REFRESH_TOKEN_INVALID_OR_REUSED();
    }
    const roles = await this.usersRepository.findRoleNames(user.id);

    const accessToken = this.tokenService.signAccessToken({
      userId: user.id,
      roles,
      emailVerified: user.emailVerified,
    });

    return {
      accessToken,
      refreshToken: newRefresh.token,
      expiresIn: this.tokenService.accessTokenExpiresIn,
    };
  }

  /**
   * `POST /auth/firebase/exchange` (Fase 3, documento de diseño Fase 1) —
   * intercambia un ID token de Firebase YA VERIFICADO por una sesión
   * propia del backend. Ningún dato de identidad (`firebaseUid`, `email`,
   * `provider`) sale de acá si no vino DENTRO del token firmado — nunca
   * de un body, que esta ruta ni siquiera acepta (ver `AuthController`).
   */
  async exchangeFirebaseToken(idToken: string, ip: string): Promise<AuthResponse> {
    const checkRevoked = process.env.FIREBASE_CHECK_REVOKED === 'true';

    let verified;
    try {
      verified = await this.firebaseTokenVerifier.verify(idToken, checkRevoked);
    } catch (error) {
      if (error instanceof FirebaseTokenExpiredError) throw FIREBASE_TOKEN_EXPIRED();
      if (error instanceof FirebaseTokenRevokedError) throw FIREBASE_TOKEN_REVOKED();
      if (error instanceof FirebaseProjectMismatchError) throw FIREBASE_PROJECT_MISMATCH();
      if (error instanceof FirebaseTokenInvalidError) throw FIREBASE_TOKEN_INVALID();
      throw error;
    }

    // Política de RidePro (documento de diseño Fase 1 §9): el exchange
    // exige email verificado, sin excepción de proveedor — Google/Apple
    // llegan verificados por el propio proveedor en la práctica, pero no
    // se asume, se exige el claim real del token.
    if (!verified.emailVerified) {
      throw FIREBASE_EMAIL_NOT_VERIFIED();
    }
    if (!verified.email) {
      // Defensivo — ningún flujo real de la app (password/Google/Apple)
      // produce un ID token sin email, pero `email` es opcional en el
      // tipo del SDK.
      throw FIREBASE_TOKEN_INVALID();
    }

    // Capas 2 y 3 del rate limit híbrido (Fase 4.2 Parte 2) — recién acá,
    // porque ambas necesitan una identidad YA verificada (Capa 1, en el
    // controller/guard por IP, ya filtró tokens inválidos antes de llegar
    // hasta acá). Capa 2 primero: es la protección real por identidad, más
    // estricta; Capa 3 después, como respaldo para "muchas identidades
    // desde una sola IP" sin penalizar redes compartidas legítimas.
    const uidKey = `${FIREBASE_EXCHANGE_UID_THROTTLER_NAME}:${hashForRateLimitKey(verified.uid)}`;
    const uidRecord = await this.throttlerStorage.increment(
      uidKey,
      RATE_LIMIT_WINDOW_MS,
      FIREBASE_EXCHANGE_UID_LIMIT,
      RATE_LIMIT_WINDOW_MS,
      FIREBASE_EXCHANGE_UID_THROTTLER_NAME,
    );
    if (uidRecord.isBlocked) {
      throw FIREBASE_EXCHANGE_RATE_LIMITED(Math.ceil(uidRecord.timeToBlockExpire));
    }

    const ipVerifiedKey = `${FIREBASE_EXCHANGE_IP_VERIFIED_THROTTLER_NAME}:${ip}`;
    const ipVerifiedRecord = await this.throttlerStorage.increment(
      ipVerifiedKey,
      RATE_LIMIT_WINDOW_MS,
      FIREBASE_EXCHANGE_IP_VERIFIED_LIMIT,
      RATE_LIMIT_WINDOW_MS,
      FIREBASE_EXCHANGE_IP_VERIFIED_THROTTLER_NAME,
    );
    if (ipVerifiedRecord.isBlocked) {
      throw FIREBASE_EXCHANGE_RATE_LIMITED(Math.ceil(ipVerifiedRecord.timeToBlockExpire));
    }

    const provider = normalizeFirebaseProvider(verified.signInProvider);

    let upsertResult;
    try {
      upsertResult = await this.usersRepository.upsertByFirebaseUid({
        firebaseUid: verified.uid,
        email: verified.email,
        emailVerified: verified.emailVerified,
        displayName: verified.displayName ?? '',
        provider,
      });
    } catch (error) {
      if (error instanceof FirebaseEmailConflictError) {
        throw FIREBASE_EMAIL_CONFLICT();
      }
      throw error;
    }

    const { user, isNew } = upsertResult;
    const roles = await this.usersRepository.findRoleNames(user.id);

    // Auditoría (Fase 3 §F) — nunca el ID token ni el firebase_uid
    // completo en `metadata`, solo lo estrictamente necesario para poder
    // reconstruir "quién, con qué proveedor, cuenta nueva o no".
    await this.auditLogRepository.record('auth.firebase_exchange', user.id, {
      provider,
      newUser: isNew,
    });

    return this.issueSession(user.id, user.email, user.emailVerified, roles, verified.uid);
  }

  /**
   * `POST /auth/logout` (Fase 3 §C) — revoca únicamente el refresh token
   * presentado, nunca todas las sesiones del usuario (eso sigue siendo
   * exclusivo de `DELETE /users/me`/detección de reuso). Idempotente:
   * `RefreshTokensRepository.revokeOne` no lanza si el token ya estaba
   * revocado o no existe.
   */
  async logout(userId: string, refreshToken: string): Promise<void> {
    const tokenHash = this.tokenService.hashRefreshToken(refreshToken);
    await this.refreshTokensRepository.revokeOne(userId, tokenHash);
  }

  private async issueSession(
    userId: string,
    email: string,
    emailVerified: boolean,
    roles: string[],
    firebaseUid?: string,
  ): Promise<AuthResponse> {
    const accessToken = this.tokenService.signAccessToken({
      userId,
      roles,
      emailVerified,
      firebaseUid,
    });
    const refresh = this.tokenService.issueRefreshToken();
    await this.refreshTokensRepository.create({
      userId,
      tokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });

    return {
      userId,
      email,
      emailVerified,
      accessToken,
      refreshToken: refresh.token,
      expiresIn: this.tokenService.accessTokenExpiresIn,
    };
  }
}
