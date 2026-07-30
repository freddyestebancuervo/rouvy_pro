# 1. IAM y activación de `FIREBASE_CHECK_REVOKED=true`

Evidencia cruda: [`evidencia/iam_service_account.txt`](evidencia/iam_service_account.txt),
[`evidencia/cloud_run_revisions.txt`](evidencia/cloud_run_revisions.txt).

## Service account exacta

```
gcloud run services describe ridepro-backend-dev --format="value(spec.template.spec.serviceAccountName)"
→ ridepro-backend-dev-sa@ridepro-development.iam.gserviceaccount.com
```

Roles antes del cambio (`gcloud projects get-iam-policy`, filtrado a esta SA):
`roles/cloudsql.client`, `roles/logging.logWriter`. Ningún rol administrativo.

## Autorización

Se presentó la SA exacta, el rol exacto (`roles/firebaseauth.viewer`, permiso real
`firebaseauth.users.get`) y el comando exacto al usuario **antes** de ejecutar
nada, y se esperó confirmación explícita. Confirmado, se ejecutó:

```
gcloud projects add-iam-policy-binding ridepro-development \
  --member=serviceAccount:ridepro-backend-dev-sa@ridepro-development.iam.gserviceaccount.com \
  --role=roles/firebaseauth.viewer
```

Verificado después: la SA tiene exactamente `roles/cloudsql.client`,
`roles/firebaseauth.viewer`, `roles/logging.logWriter` — ningún rol
administrativo (`firebaseauth.admin`, `owner`, `editor`) fue tocado.

## Activación y despliegue

`FIREBASE_CHECK_REVOKED` no requiere rebuild de imagen (es una comparación de
string en `AuthService.exchangeFirebaseToken`, `process.env.FIREBASE_CHECK_REVOKED === 'true'`)
— se actualizó `.env`/`.env.example` localmente y se desplegó el mismo digest
inmutable (`sha256:0f5984a987f...`) con la env var actualizada:

```
gcloud run services update ridepro-backend-dev \
  --image=...api@sha256:0f5984a987fde36d56c159ceffcd568c037fcc493b860614e51075f0dd29d6c6 \
  --update-env-vars=FIREBASE_CHECK_REVOKED=true
→ revisión ridepro-backend-dev-00004-5jk, Ready=True
```

`GET /v1/health` → `200 {"status":"ok","database":"connected"}` inmediatamente después.

## Prueba real contra Cloud Run (no simulada)

Usuario Firebase de prueba dedicado (creado y luego eliminado al final, junto
con su fila en Postgres — ver limpieza en cada script de esta fase):

| Caso | Resultado real |
|---|---|
| Token Firebase válido, no revocado, `checkRevoked=true` activo | `POST /v1/auth/firebase/exchange` → **200**, usuario creado en Postgres |
| Mismo usuario: revocar sus refresh tokens de Firebase (`accounts:update` con `validSince` = ahora, vía REST Admin, ADC + `x-goog-user-project`) | `validSince` confirmado por `accounts:lookup` |
| Reenviar el **mismo** ID token (emitido antes de la revocación) | `POST /v1/auth/firebase/exchange` → **401 `FIREBASE_TOKEN_REVOKED`** |
| Nuevo `signInWithPassword` del mismo usuario (token emitido después de revocar) | `POST /v1/auth/firebase/exchange` → **200** — confirma que la revocación no rompe el flujo normal, solo bloquea el token específico ya revocado |

Nota técnica real encontrada: `Get-Date -UFormat %s` en PowerShell 5.1 no da el
epoch UTC correcto en este entorno (offset de zona horaria) — el primer intento
de revocación puso un `validSince` anterior a la creación de la cuenta, sin
efecto. Corregido usando `[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()`.

## Estado de `.env`/`.env.example`

Actualizados a `FIREBASE_CHECK_REVOKED=true` con comentario actualizado
(rol ya otorgado en Development; en un entorno nuevo sin el rol, debe quedar
en `false`).

## Limpieza

Usuario Firebase de prueba y su fila en Postgres (`users`/`user_roles`/`audit_log`)
eliminados al finalizar — verificado que la tabla `users` volvió a 4 filas
(las originales), cuenta QA sin tocar.
