/**
 * Errores de dominio de `FirebaseTokenVerifierService` — agnósticos de
 * HTTP a propósito, mismo principio que `TokenService.verifyAccessToken`
 * (ver su docblock): quien traduce esto a una respuesta HTTP concreta es
 * la capa de servicio/controlador (`modules/auth/`), no este módulo.
 *
 * Nunca llevan el mensaje/stack original del SDK de Firebase como
 * `message` — cada uno tiene un mensaje fijo y genérico, para no filtrar
 * detalles internos del SDK al resto del código (y, en última instancia,
 * al cliente).
 */
export abstract class FirebaseVerificationError extends Error {}

export class FirebaseTokenInvalidError extends FirebaseVerificationError {
  constructor() {
    super('El token de Firebase no es válido.');
    this.name = 'FirebaseTokenInvalidError';
  }
}

export class FirebaseTokenExpiredError extends FirebaseVerificationError {
  constructor() {
    super('El token de Firebase expiró.');
    this.name = 'FirebaseTokenExpiredError';
  }
}

export class FirebaseTokenRevokedError extends FirebaseVerificationError {
  constructor() {
    super('El token de Firebase fue revocado.');
    this.name = 'FirebaseTokenRevokedError';
  }
}

/**
 * `aud` del token no coincide con `FIREBASE_PROJECT_ID` — detectado ANTES
 * de invocar al SDK (ver `FirebaseTokenVerifierService.verify`), porque
 * `firebase-admin` no distingue este caso con un código de error propio
 * (lo agrupa dentro de su error genérico de verificación fallida).
 */
export class FirebaseProjectMismatchError extends FirebaseVerificationError {
  constructor() {
    super('El token de Firebase pertenece a un proyecto distinto.');
    this.name = 'FirebaseProjectMismatchError';
  }
}
