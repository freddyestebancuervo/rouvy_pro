import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../../common/exceptions/api.exception';

/**
 * Códigos de error de `POST /auth/firebase/exchange` y `POST /auth/logout`
 * (Fase 3, documento de diseño Fase 1) — todos `401` salvo el conflicto de
 * email (`409`). Ningún mensaje reenvía texto interno del SDK de Firebase
 * ni de Postgres — mensajes fijos, en español, mismos que el resto del
 * proyecto.
 */
export const FIREBASE_TOKEN_MISSING = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'FIREBASE_TOKEN_MISSING',
    'Falta el token de Firebase (header Authorization).',
  );

export const FIREBASE_TOKEN_INVALID = (): ApiException =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'FIREBASE_TOKEN_INVALID', 'El token de Firebase no es válido.');

export const FIREBASE_TOKEN_EXPIRED = (): ApiException =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'FIREBASE_TOKEN_EXPIRED', 'El token de Firebase expiró.');

export const FIREBASE_TOKEN_REVOKED = (): ApiException =>
  new ApiException(HttpStatus.UNAUTHORIZED, 'FIREBASE_TOKEN_REVOKED', 'El token de Firebase fue revocado.');

export const FIREBASE_PROJECT_MISMATCH = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'FIREBASE_PROJECT_MISMATCH',
    'El token de Firebase pertenece a un proyecto distinto.',
  );

export const FIREBASE_EMAIL_NOT_VERIFIED = (): ApiException =>
  new ApiException(
    HttpStatus.UNAUTHORIZED,
    'FIREBASE_EMAIL_NOT_VERIFIED',
    'Verificá tu correo antes de continuar.',
  );

export const FIREBASE_EMAIL_CONFLICT = (): ApiException =>
  new ApiException(
    HttpStatus.CONFLICT,
    'FIREBASE_EMAIL_CONFLICT',
    'Ya existe una cuenta con ese correo, no vinculada a esta identidad de Firebase.',
  );

/**
 * Fase 4.2 Parte 2 — rate limit híbrido de `firebase/exchange` (Capas 2 y 3,
 * ver `AuthService.exchangeFirebaseToken`): mismo código `RATE_LIMITED` que
 * ya usa el guard por IP (Capa 1) — el cliente no necesita distinguir qué
 * capa lo frenó, solo que debe esperar. `retryAfterSeconds` viene de
 * `ThrottlerStorageRecord.timeToBlockExpire` (ya en segundos), nunca
 * estimado.
 */
export const FIREBASE_EXCHANGE_RATE_LIMITED = (retryAfterSeconds: number): ApiException =>
  new ApiException(
    HttpStatus.TOO_MANY_REQUESTS,
    'RATE_LIMITED',
    'Demasiadas solicitudes, intentá de nuevo más tarde.',
    null,
    retryAfterSeconds,
  );
