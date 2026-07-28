# 4. Las 5 vulnerabilidades "altas" de `npm audit --omit=dev`, una por una

Evidencia cruda: [`evidencia/npm_audit_prod.json`](evidencia/npm_audit_prod.json)
(`npm audit --omit=dev --json`). Totales: 0 críticas, **5 altas**, 10
moderadas, 0 bajas — 15 en total, sobre 256 dependencias de producción.

Ninguna dependencia fue actualizada automáticamente: las 5 comparten la misma
mitigación (upgrade mayor de `@nestjs/*`, `v10`→`v11`, marcado por npm como
`isSemVerMajor: true`), que rompe API en todos los módulos del backend y
requiere su propia ventana de regresión — no se ejecuta sin autorización
explícita y separada.

---

## 4.1 `@nestjs/platform-express` (directa, `^10.3.10` → instalada `10.4.22`)

- **Naturaleza real**: no es una vulnerabilidad propia del paquete — es un
  hallazgo "rollup" que `npm audit` genera porque este paquete depende de
  `body-parser`, `express` y `multer`, que sí tienen hallazgos propios (ver
  4.2–4.5). El campo `via` de la auditoría lista exactamente esos tres
  nombres, no un CVE de `platform-express` en sí.
- **Ruta**: dependencia directa de `package.json` → `node_modules/@nestjs/platform-express`.
- **Alcance real**: el runtime de producción SÍ usa este paquete (es el
  adaptador HTTP de Nest, `main.ts` lo instancia vía `NestFactory.create`).
- **Mitigación**: el propio `npm audit` indica que la única corrección es
  `@nestjs/platform-express@11.1.28` — un major de NestJS. No se aplica ahora
  (breaking change real en toda la app: `@nestjs/core`, `@nestjs/common`, todo
  el árbol de módulos depende de la v10). Plan: evaluar el upgrade v10→v11 como
  iniciativa propia, con su propia suite de regresión completa antes de tocar
  Development o Producción.

## 4.2 `multer@2.0.2` (transitiva, vía `@nestjs/platform-express`)

- **Advisories**: 5 CVEs de Denial-of-Service — limpieza incompleta de archivos
  temporales, agotamiento de recursos, recursión no controlada, nombres de
  campo profundamente anidados, limpieza incompleta de subidas abortadas
  (GHSA-xf7r-hgr6-v32p, GHSA-v52c-386h-88mc, GHSA-5528-5vmv-3xc2,
  GHSA-72gw-mp4g-v24j, GHSA-3p4h-7m6x-2hcm).
- **Ruta**: `@nestjs/platform-express@10.4.22` → `multer@2.0.2`.
- **Alcance real**: `multer` es middleware de `multipart/form-data` (subida de
  archivos). Verificado con `grep -rn "multer\|FileInterceptor\|UploadedFile\|MulterModule" src/`
  → **cero coincidencias**. Ningún controlador de este backend usa subida de
  archivos — el middleware está presente en el árbol de dependencias pero
  **nunca se monta ni se invoca**. No explotable en el código actual.
- **Mitigación**: sin acción — no reachable. Se revisará de nuevo si en algún
  momento se agrega subida de archivos (ej. avatar de usuario, roadmap
  conocido) — ese día sí importa la versión de `multer` en uso.

## 4.3 `glob` (transitiva, `10.4.5` en el árbol de producción)

- **Advisory**: GHSA-5j98-mcp5-4vw2 — inyección de comandos vía las flags
  `-c`/`--cmd` del **CLI** de `glob` (ejecuta las coincidencias con `shell:true`).
- **Ruta real de producción**: `firebase-admin@14.2.0` → `@google-cloud/firestore@8.7.0`
  → `google-gax@5.0.8` → `rimraf@5.0.10` → `glob@10.4.5`.
- **Alcance real**: la vulnerabilidad es específicamente del **binario CLI**
  de `glob` (`-c`/`--cmd`). En esta ruta, `glob` se usa como librería interna
  de `rimraf` (para borrar archivos temporales de caché/credenciales que
  gestiona `google-gax` internamente) — nunca se invoca el CLI de `glob` desde
  este backend, y ningún input de un request HTTP llega a construir ese
  comando. No explotable en el código actual.
- **Mitigación**: sin acción — no reachable. Se resolvería igualmente en cuanto
  `firebase-admin`/`google-gax` actualicen su `rimraf` transitivo (fuera de
  nuestro control directo, no requiere tocar nuestro `package.json`).

## 4.4 `minimatch@9.0.9` (transitiva, misma ruta que 4.3)

- **Advisory**: hereda el hallazgo de `brace-expansion` (ver 4.5) — `minimatch`
  en sí no tiene un CVE propio en este reporte, aparece "alta" porque
  `npm audit` propaga la severidad de su dependencia.
- **Ruta real de producción**: `firebase-admin` → `@google-cloud/firestore` →
  `google-gax` → `rimraf@5.0.10` → `glob@10.4.5` → `minimatch@9.0.9`.
- **Alcance real**: mismo razonamiento que 4.3 — patrones internos de
  `rimraf`/`google-gax` para limpieza de archivos temporales, nunca
  patrones derivados de input de un cliente HTTP.
- **Mitigación**: sin acción — no reachable, misma cadena de actualización
  transitiva que 4.3.

## 4.5 `brace-expansion@2.1.2` (transitiva, misma ruta que 4.3/4.4)

- **Advisory**: GHSA-mh99-v99m-4gvg — Denial-of-Service por expansión de
  llaves (`{a,b,...}`) sin límite, causando agotamiento de memoria (OOM) con
  un patrón especialmente construido.
- **Ruta real de producción**: `firebase-admin` → `@google-cloud/firestore` →
  `google-gax` → `rimraf@5.0.10` → `glob@10.4.5` → `minimatch@9.0.9` →
  `brace-expansion@2.1.2`.
- **Alcance real**: para explotarse, un atacante necesitaría controlar el
  patrón de glob/minimatch que llega a esta librería. En esta ruta el patrón
  lo genera internamente `rimraf` a partir de rutas de archivos temporales
  propias del proceso (cachés de credenciales/gRPC de `google-gax`) — ningún
  valor de un request HTTP entrante llega a construir ese patrón. No
  explotable en el código actual.
- **Mitigación**: sin acción — no reachable, misma cadena transitiva de 4.3/4.4.

---

## Resumen de reachability

| Vulnerabilidad | Reachable desde HTTP entrante | Acción |
|---|---|---|
| `@nestjs/platform-express` (rollup) | — (hallazgo derivado) | monitorear upgrade v11 |
| `multer` (5 CVEs DoS) | No — sin uso de subida de archivos en el código | ninguna |
| `glob` (CLI cmd injection) | No — CLI nunca invocado, solo librería interna de `rimraf` | ninguna |
| `minimatch` (hereda de brace-expansion) | No — mismo camino interno | ninguna |
| `brace-expansion` (DoS por expansión) | No — patrones generados internamente, no por input externo | ninguna |

Ninguna de las 5 vulnerabilidades altas es explotable con el código y la
configuración actuales de `ridepro-backend-dev`. Las 3 de la cadena
`firebase-admin`→`google-gax`→`rimraf` se resuelven solas cuando esas
librerías de Google actualicen su dependencia transitiva; las 2 restantes
(`platform-express`/`multer`) requieren el mismo upgrade mayor de NestJS, que
queda fuera de esta fase por riesgo real de ruptura.
