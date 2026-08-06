import { Module } from '@nestjs/common';
import { applicationDefault, getApp, initializeApp } from 'firebase-admin/app';
import { Auth, getAuth } from 'firebase-admin/auth';
import { FIREBASE_AUTH } from './firebase-auth.token';
import { FirebaseTokenVerifierService } from './firebase-token-verifier.service';

/**
 * Puente Firebase Auth → NestJS (Fase 3, ver documento de diseño Fase 1).
 * Solo `AuthModule` lo necesita hoy — no se declara `@Global()` como
 * `JwtModule` (que sí lo necesitan varios módulos sin relación entre sí).
 *
 * Provee directamente el servicio `Auth` (no el `App` completo) — es lo
 * único que `FirebaseTokenVerifierService` necesita, y es trivialmente
 * mockeable en tests (`{ verifyIdToken: jest.fn() }`), a diferencia de un
 * `App` real cuyo registro interno de componentes no se puede simular con
 * un objeto plano.
 *
 * Credenciales: exclusivamente Application Default Credentials
 * (`applicationDefault()`) — NUNCA un JSON de cuenta de servicio
 * descargado. En Cloud Run, ADC resuelve automáticamente contra la
 * identidad de la revisión (`ridepro-backend-dev-sa`, nunca la cuenta de
 * Compute por defecto) vía el metadata server, sin ningún archivo de
 * credenciales en la imagen ni en el repo.
 *
 * `FIREBASE_PROJECT_ID` es obligatoria y se valida explícitamente (falla
 * rápido al arrancar si falta) — mismo principio que `TokenService` con
 * `JWT_PRIVATE_KEY_PATH`/`JWT_PUBLIC_KEY_PATH`.
 */
@Module({
  providers: [
    {
      provide: FIREBASE_AUTH,
      useFactory: (): Auth => {
        const projectId = process.env.FIREBASE_PROJECT_ID;
        if (!projectId) {
          throw new Error('FIREBASE_PROJECT_ID no está definida — ver .env.example.');
        }
        // Reutiliza la app "[DEFAULT]" si ya existe en el proceso (p. ej.
        // dos instancias de la aplicación Nest en el mismo proceso de
        // test — ver rate-limit-multi-instance.e2e-spec.ts, T-F0.4) en
        // vez de que `initializeApp()` falle porque el SDK de
        // `firebase-admin` registra esa app a nivel de proceso, no por
        // contenedor de DI. Nunca crea una app con nombre distinto de
        // "[DEFAULT]".
        const app = (() => {
          try {
            return getApp();
          } catch {
            return initializeApp({
              credential: applicationDefault(),
              projectId,
            });
          }
        })();
        return getAuth(app);
      },
    },
    FirebaseTokenVerifierService,
  ],
  exports: [FirebaseTokenVerifierService],
})
export class FirebaseAdminModule {}
