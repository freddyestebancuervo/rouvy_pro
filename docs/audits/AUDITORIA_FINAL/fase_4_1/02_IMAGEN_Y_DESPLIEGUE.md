# 2. Imagen y despliegue

## Imagen

- Build: `docker build --no-cache` (sin reutilizar capas de builds previos).
- Tag inmutable: `southamerica-east1-docker.pkg.dev/ridepro-development/ridepro-backend/api:dev-20260728-005941`.
- Digest: `sha256:cb6390995eb955e091c300bcb6cf10aaa9092570bf11e6b12d8db266335d2d37`.
- Push: una sola vez, confirmado con `gcloud artifacts docker images describe`.
- `:dev` (tag estable) sin tocar — sigue apuntando a `sha256:8de7065ce115db71c937d7dc540d9426950bd1f8e5140a93e7f036e26819b9da` (digest anterior a toda esta sesión).

## Validación local de la imagen

| Chequeo | Resultado |
|---|---|
| Usuario no root | `Config.User = node` |
| Healthcheck | configurado (`GET /v1/health`, 30s/5s/10s/3 reintentos) |
| Secretos | 0 `.env`/`secrets/`/`*.pem`/`*.key` propios (solo CA del SO) |
| Archivos de test | 0 `*.e2e-spec.*` |
| devDependencies | 0 (`eslint`/`ts-jest`/`typescript` ausentes) |
| Funcionamiento básico de `/auth/firebase/exchange` | contenedor local + Postgres 16 efímero + claves JWT reales: `GET /v1/health` → 200; `POST /auth/firebase/exchange` sin token → 401 `FIREBASE_TOKEN_MISSING`; con token inválido → 401 `FIREBASE_TOKEN_INVALID` — sin crash, sin stack trace crudo |

## Despliegue

Comando (por digest, sin tocar ninguna otra variable/config):
```
gcloud run services update ridepro-backend-dev \
  --project=ridepro-development --region=southamerica-east1 \
  --image=...api@sha256:cb6390995eb955e091c300bcb6cf10aaa9092570bf11e6b12d8db266335d2d37
```

Resultado: revisión `ridepro-backend-dev-00007-llf`, Ready=True, sirviendo
100% del tráfico.

Confirmaciones post-despliegue:
- `GET /v1/health` → `200 {"status":"ok","database":"connected"}`.
- `FIREBASE_CHECK_REVOKED=true` preservado (verificado vía
  `gcloud run services describe --format=yaml`).
- Las 7 revisiones anteriores permanecen disponibles (`00001-lff` a
  `00006-rrp`), ninguna eliminada.

## Rollback

```
gcloud run services update-traffic ridepro-backend-dev \
  --to-revisions=ridepro-backend-dev-00006-rrp=100 \
  --project=ridepro-development --region=southamerica-east1
```

`00006-rrp` es la revisión estable inmediatamente anterior (Fase 4,
`FIREBASE_CHECK_REVOKED=true`, sin la corrección de concurrencia) — no
requiere rebuild, cambio instantáneo de tráfico.
