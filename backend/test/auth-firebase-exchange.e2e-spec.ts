import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import * as jwt from 'jsonwebtoken';
import * as request from 'supertest';
import {
  FirebaseProjectMismatchError,
  FirebaseTokenExpiredError,
  FirebaseTokenInvalidError,
  FirebaseTokenRevokedError,
} from '../src/firebase/errors/firebase-verification.errors';
import { FirebaseTokenVerifierService } from '../src/firebase/firebase-token-verifier.service';
import { createTestApp } from './utils/test-app';

/**
 * e2e de `POST /auth/firebase/exchange` (Fase 3) contra Postgres real —
 * mismo principio "sin mocks" que el resto de la suite, salvo por
 * `FirebaseTokenVerifierService`: mockeado a propósito (Fase 3 §G, "no
 * dependas de Firebase real para la suite normal") vía
 * `createTestApp([...])`. Todo lo demás (Postgres, `TokenService`, rate
 * limiting real) corre real.
 *
 * Archivo separado (mismo criterio que `auth-refresh.e2e-spec.ts`): cada
 * `*.e2e-spec.ts` obtiene su propio `ThrottlerStorage` en memoria, así
 * el test de rate limiting de acá no interfiere con el de otros archivos.
 */
describe('AuthController (e2e) — /auth/firebase/exchange', () => {
  let app: INestApplication;
  let verifyMock: jest.Mock;

  beforeAll(async () => {
    verifyMock = jest.fn();
    app = await createTestApp([
      { provide: FirebaseTokenVerifierService, useValue: { verify: verifyMock } },
    ]);
  });

  afterEach(() => {
    verifyMock.mockReset();
  });

  afterAll(async () => {
    await app.close();
  });

  function mockVerifiedToken(overrides?: Partial<Record<string, unknown>>) {
    verifyMock.mockResolvedValue({
      uid: `firebase-uid-${randomUUID()}`,
      email: `e2e-exchange-${randomUUID()}@ridepro.com`,
      emailVerified: true,
      displayName: 'Rider Firebase E2E',
      signInProvider: 'google.com',
      ...overrides,
    });
  }

  it('sin Authorization: 401 FIREBASE_TOKEN_MISSING', async () => {
    const res = await request(app.getHttpServer()).post('/v1/auth/firebase/exchange').expect(401);
    expect(res.body.error.code).toBe('FIREBASE_TOKEN_MISSING');
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it('Authorization sin "Bearer ": 401 FIREBASE_TOKEN_MISSING', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'esto-no-es-bearer')
      .expect(401);
    expect(res.body.error.code).toBe('FIREBASE_TOKEN_MISSING');
  });

  it('Authorization "Bearer" sin token: 401 FIREBASE_TOKEN_MISSING', async () => {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer ')
      .expect(401);
    expect(res.body.error.code).toBe('FIREBASE_TOKEN_MISSING');
  });

  it.each([
    [new FirebaseTokenInvalidError(), 'FIREBASE_TOKEN_INVALID'],
    [new FirebaseTokenExpiredError(), 'FIREBASE_TOKEN_EXPIRED'],
    [new FirebaseTokenRevokedError(), 'FIREBASE_TOKEN_REVOKED'],
    [new FirebaseProjectMismatchError(), 'FIREBASE_PROJECT_MISMATCH'],
  ])('el verificador rechaza con %p → 401 %s, sin stack trace ni mensaje del SDK', async (error, code) => {
    verifyMock.mockRejectedValueOnce(error);

    const res = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer un-token-cualquiera')
      .expect(401);

    expect(res.body.error.code).toBe(code);
    expect(JSON.stringify(res.body)).not.toMatch(/at .*firebase-admin|node_modules/);
  });

  it('email no verificado: 401 FIREBASE_EMAIL_NOT_VERIFIED', async () => {
    mockVerifiedToken({ emailVerified: false });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer un-token-cualquiera')
      .expect(401);

    expect(res.body.error.code).toBe('FIREBASE_EMAIL_NOT_VERIFIED');
  });

  it('usuario nuevo: 200, crea la fila real en Postgres, y el access token trae sub=id de Postgres + claim firebaseUid', async () => {
    const firebaseUid = `firebase-uid-${randomUUID()}`;
    const email = `e2e-exchange-nuevo-${randomUUID()}@ridepro.com`;
    mockVerifiedToken({ uid: firebaseUid, email, displayName: 'Nuevo Por Exchange' });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer un-token-cualquiera')
      .expect(200);

    expect(res.body.email).toBe(email);
    expect(res.body.emailVerified).toBe(true);
    expect(typeof res.body.accessToken).toBe('string');
    expect(res.body.refreshToken).toMatch(/^rt_/);
    expect(res.body.expiresIn).toBe(3600);

    const decoded = jwt.decode(res.body.accessToken as string) as Record<string, unknown>;
    expect(decoded.sub).toBe(res.body.userId); // sub = id de Postgres, no el uid de Firebase
    expect(decoded.sub).not.toBe(firebaseUid);
    expect(decoded.firebaseUid).toBe(firebaseUid);
  });

  it('usuario existente (mismo firebaseUid dos veces): reutiliza la misma fila, no duplica', async () => {
    const firebaseUid = `firebase-uid-${randomUUID()}`;
    const email = `e2e-exchange-existente-${randomUUID()}@ridepro.com`;

    mockVerifiedToken({ uid: firebaseUid, email, displayName: 'Nombre Original' });
    const first = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer token-1')
      .expect(200);

    mockVerifiedToken({ uid: firebaseUid, email, displayName: 'Nombre Actualizado' });
    const second = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer token-2')
      .expect(200);

    expect(second.body.userId).toBe(first.body.userId);
  });

  it('colisión de email: usuario legacy con password ya registrado con el mismo email → 409 FIREBASE_EMAIL_CONFLICT', async () => {
    const email = `e2e-exchange-colision-${randomUUID()}@ridepro.com`;
    await request(app.getHttpServer())
      .post('/v1/auth/register')
      .send({ email, password: 'Abcdefg1', displayName: 'Legacy Password' })
      .expect(201);

    mockVerifiedToken({ uid: `firebase-uid-${randomUUID()}`, email });

    const res = await request(app.getHttpServer())
      .post('/v1/auth/firebase/exchange')
      .set('Authorization', 'Bearer un-token-cualquiera')
      .expect(409);

    expect(res.body.error.code).toBe('FIREBASE_EMAIL_CONFLICT');
  });
});
