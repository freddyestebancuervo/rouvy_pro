/**
 * T-F0.4 (docs/audits/AUDITORIA_FINAL/BACKLOG_MAESTRO.md) — única fuente
 * de la URL de Redis usada por el `ThrottlerStorage` distribuido (ver
 * `app.module.ts`). Mismo criterio que `createDatabasePool`
 * (`database.config.ts`) y `FirebaseAdminModule`: falla rápido al
 * arrancar si falta, en vez de dejar que `RedisModule`/`redis` fallen más
 * tarde con un error menos claro.
 */
export function resolveRedisUrl(): string {
  const url = process.env.REDIS_URL;
  if (!url) {
    throw new Error(
      'REDIS_URL no está definida — copiar .env.example a .env y configurarla antes de arrancar.',
    );
  }
  return url;
}
