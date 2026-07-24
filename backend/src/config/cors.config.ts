import { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

/**
 * Auditoría 2026-07-23: `app.enableCors()` sin argumentos (visto en
 * `main.ts` hasta ahora) refleja `Access-Control-Allow-Origin` con
 * CUALQUIER origen que mande la request — aceptable como parche temporal
 * mientras no existía ningún origen de producción, pero inaceptable antes
 * de cerrar D2, tal como está documentado en `ApiConfig` (Flutter) que
 * este backend también sirve a Flutter Web.
 *
 * Estrategia (falla cerrado, nunca abierto):
 *   1. `CORS_ALLOWED_ORIGINS` definida (cualquier entorno, incluido dev
 *      si se quiere acotar) → allowlist explícita, coma-separada.
 *   2. Sin definir y `NODE_ENV !== 'production'` → fallback de
 *      conveniencia: cualquier `http(s)://localhost:PUERTO` o
 *      `127.0.0.1:PUERTO`, porque `flutter run -d chrome` asigna un
 *      puerto distinto en cada corrida y no tiene sentido pedirle a cada
 *      desarrollador que lo fije a mano para poder levantar la app. Sigue
 *      sin aceptar ningún origen no-local.
 *   3. Sin definir y `NODE_ENV === 'production'` → CORS completamente
 *      cerrado (`origin: false`). Un despliegue de producción sin
 *      `CORS_ALLOWED_ORIGINS` configurada debe fallar de forma visible
 *      (Flutter Web no puede llamar al backend) en vez de fallar abierto
 *      (cualquier sitio puede llamarlo).
 */
export function resolveCorsOptions(): CorsOptions {
  const configured = process.env.CORS_ALLOWED_ORIGINS?.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (configured && configured.length > 0) {
    return { origin: configured };
  }

  if (process.env.NODE_ENV !== 'production') {
    return { origin: /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ };
  }

  return { origin: false };
}
