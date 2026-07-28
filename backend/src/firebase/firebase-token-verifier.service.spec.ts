import * as jwt from 'jsonwebtoken';
import type { Auth } from 'firebase-admin/auth';
import { FirebaseTokenVerifierService } from './firebase-token-verifier.service';
import {
  FirebaseProjectMismatchError,
  FirebaseTokenExpiredError,
  FirebaseTokenInvalidError,
  FirebaseTokenRevokedError,
} from './errors/firebase-verification.errors';

/**
 * Unit tests — sin firebase-admin real: `jwt.decode()` (para el chequeo
 * temprano de `aud`, ver docblock de `assertMatchesConfiguredProject`) es
 * el único código de `jsonwebtoken` que se ejercita de verdad, con JWTs
 * sintéticos firmados con un secreto cualquiera (HS256) — `decode()` no
 * verifica firma, así que sirve igual para poblar claims de prueba.
 * `admin.app.App` se mockea completo. Mismo principio que pide la Fase 3
 * §G: "no dependas de Firebase real para la suite normal".
 */
describe('FirebaseTokenVerifierService', () => {
  const PROJECT_ID = 'ridepro-development';
  const originalProjectId = process.env.FIREBASE_PROJECT_ID;

  beforeAll(() => {
    process.env.FIREBASE_PROJECT_ID = PROJECT_ID;
  });

  afterAll(() => {
    process.env.FIREBASE_PROJECT_ID = originalProjectId;
  });

  function fakeIdToken(aud: string): string {
    return jwt.sign({ aud, sub: 'whatever' }, 'test-secret-solo-para-decode', {
      algorithm: 'HS256',
    });
  }

  function buildService(verifyIdToken: jest.Mock) {
    const auth = { verifyIdToken } as unknown as Auth;
    return new FirebaseTokenVerifierService(auth);
  }

  it('token mal formado (ni siquiera un JWT decodificable): FirebaseTokenInvalidError, sin llamar al SDK', async () => {
    const verifyIdToken = jest.fn();
    const service = buildService(verifyIdToken);

    await expect(service.verify('esto-no-es-un-jwt', false)).rejects.toBeInstanceOf(
      FirebaseTokenInvalidError,
    );
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('proyecto equivocado (aud no coincide con FIREBASE_PROJECT_ID): FirebaseProjectMismatchError, sin llamar al SDK', async () => {
    const verifyIdToken = jest.fn();
    const service = buildService(verifyIdToken);
    const token = fakeIdToken('otro-proyecto-firebase');

    await expect(service.verify(token, false)).rejects.toBeInstanceOf(FirebaseProjectMismatchError);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  it('token válido: devuelve los claims mapeados y pasa checkRevoked al SDK', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({
      uid: 'firebase-uid-123',
      email: 'rider@ridepro.com',
      email_verified: true,
      name: 'Rider Firebase',
      firebase: { sign_in_provider: 'google.com' },
    });
    const service = buildService(verifyIdToken);
    const token = fakeIdToken(PROJECT_ID);

    const result = await service.verify(token, true);

    expect(verifyIdToken).toHaveBeenCalledWith(token, true);
    expect(result).toEqual({
      uid: 'firebase-uid-123',
      email: 'rider@ridepro.com',
      emailVerified: true,
      displayName: 'Rider Firebase',
      signInProvider: 'google.com',
    });
  });

  it('token válido sin nombre/proveedor (password, primer login): campos opcionales quedan null', async () => {
    const verifyIdToken = jest.fn().mockResolvedValue({
      uid: 'firebase-uid-456',
      email: 'rider2@ridepro.com',
      email_verified: false,
      firebase: { sign_in_provider: 'password' },
    });
    const service = buildService(verifyIdToken);

    const result = await service.verify(fakeIdToken(PROJECT_ID), false);

    expect(result.displayName).toBeNull();
    expect(result.emailVerified).toBe(false);
    expect(result.signInProvider).toBe('password');
  });

  it('token expirado (auth/id-token-expired): FirebaseTokenExpiredError', async () => {
    const verifyIdToken = jest.fn().mockRejectedValue(
      Object.assign(new Error('Firebase ID token has expired'), { code: 'auth/id-token-expired' }),
    );
    const service = buildService(verifyIdToken);

    await expect(service.verify(fakeIdToken(PROJECT_ID), false)).rejects.toBeInstanceOf(
      FirebaseTokenExpiredError,
    );
  });

  it('token revocado (auth/id-token-revoked): FirebaseTokenRevokedError', async () => {
    const verifyIdToken = jest.fn().mockRejectedValue(
      Object.assign(new Error('Firebase ID token has been revoked'), {
        code: 'auth/id-token-revoked',
      }),
    );
    const service = buildService(verifyIdToken);

    await expect(service.verify(fakeIdToken(PROJECT_ID), true)).rejects.toBeInstanceOf(
      FirebaseTokenRevokedError,
    );
  });

  it('token inválido (firma corrupta u otro rechazo del SDK): FirebaseTokenInvalidError, sin exponer el mensaje interno del SDK', async () => {
    const verifyIdToken = jest.fn().mockRejectedValue(
      Object.assign(new Error('Decoding Firebase ID token failed. Make sure...'), {
        code: 'auth/argument-error',
      }),
    );
    const service = buildService(verifyIdToken);

    const error = await service.verify(fakeIdToken(PROJECT_ID), false).catch((e) => e);

    expect(error).toBeInstanceOf(FirebaseTokenInvalidError);
    expect(error.message).not.toContain('Decoding Firebase ID token failed');
  });

  it('error del SDK sin código reconocible: cae en FirebaseTokenInvalidError (nunca escapa sin traducir)', async () => {
    const verifyIdToken = jest.fn().mockRejectedValue(new Error('algo raro'));
    const service = buildService(verifyIdToken);

    await expect(service.verify(fakeIdToken(PROJECT_ID), false)).rejects.toBeInstanceOf(
      FirebaseTokenInvalidError,
    );
  });
});
