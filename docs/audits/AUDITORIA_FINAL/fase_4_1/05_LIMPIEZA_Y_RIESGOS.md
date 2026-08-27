# 5. Limpieza, rollback y riesgos pendientes

## Limpieza — exclusivamente datos creados por esta prueba

- **Firebase Auth** (Development): 5 cuentas de prueba eliminadas
  (`accounts:delete` por `localId` exacto) — Usuario A, C1, C2, D1, D2.
- **PostgreSQL** (`ridepro-backend-dev-pg`):
  - Caso D: 2 filas sintéticas borradas por su UUID exacto dentro de un
    bloque con verificación post-borrado obligatoria (`SELECT count(*)`
    tras el `DELETE`, confirmado en `0` antes de continuar).
  - Casos A/B/C: 3 filas (`users` + `user_roles` + `audit_log` asociados)
    borradas por UUID exacto.
- **Verificado explícitamente, no asumido**: la tabla `users` volvió a
  exactamente **4 filas** (los usuarios originales del entorno), y la
  cuenta QA compartida (`[REDACTED_HISTORICAL_QA_BACKEND_EMAIL]`) sigue presente con
  `firebase_uid IS NULL` — sin tocar.
- **Temporales locales**: todos los archivos con tokens, emails, UIDs,
  contraseñas de prueba y la connection string de la base fueron
  eliminados del scratchpad al finalizar. La API key pública de Firebase
  Web (no es secreta, es un identificador de cliente) también se eliminó
  del archivo temporal por prolijidad.
- Cloud SQL Auth Proxy detenido.

## Rollback (documentado, no ejecutado — nada falló)

```
gcloud run services update-traffic ridepro-backend-dev \
  --to-revisions=ridepro-backend-dev-00006-rrp=100 \
  --project=ridepro-development --region=southamerica-east1
```

Revisión anterior (`00006-rrp`, Fase 4 con `FIREBASE_CHECK_REVOKED=true`,
sin el fix de concurrencia) verificada disponible.

## Riesgos pendientes

1. **Capacidad del pool de Postgres** (`DATABASE_POOL_MAX` en su default de
   código, `10`, nunca configurado en `ridepro-backend-dev`): bajo 20
   exchanges genuinamente concurrentes en una sola instancia, el pool se
   agota y produce `500` por timeout de conexión — no relacionado con la
   corrección de esta fase, pero es un techo de capacidad real. Requiere
   una fase separada para decidir el valor correcto de
   `DATABASE_POOL_MAX` (y evaluar si además hace falta ajustar
   `containerConcurrency`/`maxScale` de Cloud Run) — **no tocado en esta
   fase por restricción explícita**.
2. **Rate limit de 20/15min por IP en `/auth/firebase/exchange`**: correcto
   y deseado como control anti-abuso, pero implica que cualquier prueba de
   carga real (o un cliente legítimo con reintentos agresivos) puede
   agotarlo rápido. Documentado como comportamiento esperado, no como bug.
3. Los 5 hallazgos de vulnerabilidades npm "altas" y la evaluación del
   upgrade mayor de NestJS (Fase 4, punto 4) siguen pendientes, sin cambios
   en esta fase (explícitamente fuera de alcance: "no actualizar NestJS ni
   dependencias").
