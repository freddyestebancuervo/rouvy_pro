# Fase 4 — Cierre técnico posterior (IAM checkRevoked, lint, vulnerabilidades, rendimiento)

Continuación del cierre de Fase 4 (puente Firebase Auth → NestJS → PostgreSQL,
`ridepro-backend-dev`, Development). Estado general del proyecto: ver
`PROJECT_STATUS.md` en la raíz del repo (no se duplica su contenido acá).

Alcance de este cierre (orden ejecutado):

1. [IAM y `FIREBASE_CHECK_REVOKED`](01_IAM_CHECK_REVOKED.md)
2. [Corrección de `npm run lint` en `test/**`](02_LINT_FIX.md)
3. [Build, unit tests, lint y E2E completos (repetición)](03_BUILD_TEST_LINT_E2E.md)
4. [Las 5 vulnerabilidades npm "altas", documentadas individualmente](04_VULNERABILIDADES_NPM_ALTAS.md)
5. [Prueba básica de rendimiento](05_PERFORMANCE.md)
6. [Hallazgo: race condition real en `POST /auth/firebase/exchange`](06_HALLAZGO_RACE_CONDITION_EXCHANGE.md)

Evidencia cruda sanitizada (sin tokens/contraseñas/secretos/connection strings):
[`evidencia/`](evidencia/).

## Resultado en una línea por punto

| # | Resultado |
|---|---|
| IAM | `roles/firebaseauth.viewer` otorgado a `ridepro-backend-dev-sa` (autorizado explícitamente antes de ejecutar); ningún rol administrativo |
| checkRevoked | `FIREBASE_CHECK_REVOKED=true` desplegado y verificado contra Cloud Run real: token válido → 200, token revocado → 401 `FIREBASE_TOKEN_REVOKED`, sign-in nuevo post-revocación → 200 |
| Lint | 0 errores en `src/**` y `test/**`, sin exclusiones ni reglas silenciadas — causa raíz real corregida (`tsconfig.eslint.json`) |
| Build/Test/Lint/E2E | build limpio, 96/96 unit, 0 errores lint, 82/82 e2e |
| Vulnerabilidades npm altas | 5/5 documentadas individualmente; ninguna actualización automática (todas requieren bump mayor con riesgo real de ruptura) |
| Rendimiento | health/users-me/refresh con latencias saludables; cold start real medido (~8.2 s); **hallazgo real**: exchange concurrente para un usuario nuevo puede devolver 500 (3/10 en la prueba) |
| Restricciones | Sin tocar Flutter, sin tocar Producción, sin git add/commit/push, sin módulos nuevos de producto |

## Pendiente para autorización explícita (no ejecutado en esta fase)

- Corregir la race condition de `POST /auth/firebase/exchange` documentada en
  [06](06_HALLAZGO_RACE_CONDITION_EXCHANGE.md) — es una corrección de código de
  producción, fuera del alcance de "no nuevas funcionalidades" de esta fase.
- Evaluar el upgrade mayor de `@nestjs/*` (v10 → v11) que resolvería 3 de las 5
  vulnerabilidades altas — requiere ventana de regresión propia (ver punto 4).
