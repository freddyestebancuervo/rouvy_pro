import { Inject, Injectable } from '@nestjs/common';
import { Auth, DecodedIdToken } from 'firebase-admin/auth';
import * as jwt from 'jsonwebtoken';
import { FIREBASE_AUTH } from './firebase-auth.token';
import {
  FirebaseProjectMismatchError,
  FirebaseTokenExpiredError,
  FirebaseTokenInvalidError,
  FirebaseTokenRevokedError,
} from './errors/firebase-verification.errors';

export interface VerifiedFirebaseToken {
  uid: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
  /** Identificador de proveedor TAL COMO lo manda Firebase
   * (`password` | `google.com` | `apple.com` | ...) — sin normalizar acá;
   * `AuthService` es quien lo mapea a los 3 valores que acepta
   * `auth_provider` en la base. */
  signInProvider: string | null;
}

/**
 * Única responsabilidad: verificar criptográficamente un ID token de
 * Firebase y devolver sus claims ya tipados — agnóstico de HTTP (ver
 * `errors/firebase-verification.errors.ts`) y agnóstico de PostgreSQL.
 * `AuthService` (Fase 3, `/auth/firebase/exchange`) es el único
 * consumidor hoy.
 */
@Injectable()
export class FirebaseTokenVerifierService {
  constructor(@Inject(FIREBASE_AUTH) private readonly auth: Auth) {}

  /**
   * @param checkRevoked Requiere una llamada autenticada real a la API de
   * Identity Platform (no solo verificación de firma local) — depende de
   * un rol IAM todavía no otorgado sobre la cuenta de servicio de Cloud
   * Run (ver `FIREBASE_CHECK_REVOKED` en `.env.example`). Por defecto
   * queda en `false` para no romper el flujo completo mientras ese rol no
   * exista.
   */
  async verify(idToken: string, checkRevoked: boolean): Promise<VerifiedFirebaseToken> {
    this.assertMatchesConfiguredProject(idToken);

    let decoded: DecodedIdToken;
    try {
      decoded = await this.auth.verifyIdToken(idToken, checkRevoked);
    } catch (error) {
      throw this.mapVerificationError(error);
    }

    return {
      uid: decoded.uid,
      email: typeof decoded.email === 'string' ? decoded.email : null,
      emailVerified: decoded.email_verified === true,
      displayName: typeof decoded.name === 'string' ? decoded.name : null,
      signInProvider:
        typeof decoded.firebase?.sign_in_provider === 'string'
          ? decoded.firebase.sign_in_provider
          : null,
    };
  }

  /**
   * `firebase-admin` no expone un código de error dedicado para "token de
   * otro proyecto" — lo agrupa dentro de su error genérico de
   * verificación fallida (`auth/argument-error`/`auth/invalid-id-token`),
   * indistinguible de una firma corrupta. Se decodifica el token SIN
   * verificar (`jwt.decode`, nunca se confía en este valor para nada más
   * que este chequeo temprano) solo para poder devolver
   * `FIREBASE_PROJECT_MISMATCH` como un error distinto y más útil que
   * "token inválido" — la verificación criptográfica real sigue
   * ocurriendo siempre después, vía `verifyIdToken`.
   */
  private assertMatchesConfiguredProject(idToken: string): void {
    const unverified = jwt.decode(idToken) as { aud?: unknown } | null;
    // Token malformado (ni siquiera decodificable como JWT) — no es un
    // caso de "proyecto equivocado", es directamente inválido; la
    // verificación criptográfica real de abajo lo hubiera rechazado
    // igual, esto solo adelanta un error más preciso.
    if (!unverified || typeof unverified.aud !== 'string') {
      throw new FirebaseTokenInvalidError();
    }
    if (unverified.aud !== process.env.FIREBASE_PROJECT_ID) {
      throw new FirebaseProjectMismatchError();
    }
  }

  private mapVerificationError(error: unknown): Error {
    const code = this.extractFirebaseErrorCode(error);
    if (code === 'auth/id-token-expired') {
      return new FirebaseTokenExpiredError();
    }
    if (code === 'auth/id-token-revoked') {
      return new FirebaseTokenRevokedError();
    }
    // Cualquier otra falla de verificación (firma inválida, `iss`
    // incorrecto, token malformado, etc.) — nunca se reenvía
    // `error.message`/`error.stack` del SDK hacia arriba.
    return new FirebaseTokenInvalidError();
  }

  private extractFirebaseErrorCode(error: unknown): string | null {
    if (typeof error === 'object' && error !== null && 'code' in error) {
      const code = (error as { code?: unknown }).code;
      return typeof code === 'string' ? code : null;
    }
    return null;
  }
}
