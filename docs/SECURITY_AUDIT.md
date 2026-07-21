# Auditoría de seguridad — Escalada de privilegios vía `firestore.rules`

**Severidad:** Crítica · **Estado:** Mitigado en código (`firestore.rules`),
**pendiente de verificación con tests ejecutados en un entorno real** (ver
sección final).

---

## 1. La vulnerabilidad

Al implementar la tarea A2 del roadmap (añadir el campo `role` a
`users/{uid}`), la regla de Firestore propuesta originalmente en
`docs/TECHNICAL_SPECIFICATION_M0_M1.md` (sección 5.4) era:

```
allow update: if request.auth != null
              && request.auth.uid == uid
              && !request.resource.data.diff(resource.data)
                  .affectedKeys()
                  .hasAny(['role', 'premium']);

allow create: if request.auth != null && request.auth.uid == uid;
```

La regla de `update` protegía correctamente `role`/`premium` — pero la
regla de `create` **no imponía ninguna restricción sobre el contenido del
documento**, solo sobre quién podía crearlo (el propio `uid`). Un cliente
podía escribir, en la creación inicial de su propio documento, **cualquier
valor en cualquier campo**, incluyendo `role: "admin"`.

## 2. Cómo se explota (paso a paso)

Cualquier usuario autenticado, usando el SDK cliente de Firestore
directamente (sin necesidad de acceso especial, herramientas de
desarrollador, ni exploit técnico — es una llamada normal del SDK):

```javascript
// Ejecutable desde el propio navegador/app de un atacante, con una
// cuenta de usuario normal ya autenticada:
await setDoc(doc(firestore, `users/${myOwnUid}`), {
  email: 'attacker@example.com',
  displayName: 'Attacker',
  role: 'admin',        // ← la regla de `create` no lo impedía
});
```

Como la creación del documento ocurre en el primer login (ver
`AuthRemoteDataSourceImpl._fetchUserDocument` en el cliente Flutter, que
crea el documento con `.set()` si no existe todavía), y las reglas de
Firestore **no distinguen "esta escritura la hizo el código legítimo de
la app" de "esta escritura la hizo alguien llamando al SDK a mano"** — la
regla es la única barrera. Bastaba con que el atacante llamara al SDK de
Firestore directamente (posible desde cualquier cliente con las
credenciales de Firebase del proyecto, que son públicas por diseño — la
seguridad de Firebase depende enteramente de las reglas, no de ocultar la
configuración) para auto-otorgarse `role: "admin"` en su primer login.

## 3. Impacto (por qué es Crítico, no Medio/Bajo)

- **Cualquier verificación de rol que confíe en el campo `role` de
  Firestore** (paneles de admin, gates de funcionalidad premium/coach en
  el cliente, futuras Cloud Functions que lean este campo para decidir
  permisos) habría confiado en un dato que el propio atacante controlaba.
- No requiere ningún conocimiento técnico avanzado — es una llamada
  estándar del SDK, no una inyección ni un exploit de infraestructura.
- Se detectó **antes de que existiera ningún consumidor real del campo
  `role`** (el panel de administración todavía no está construido) — el
  campo se añadió en A2 y el hueco se cerró en A3, en el mismo ciclo de
  trabajo, sin ventana de exposición en producción.

## 4. La corrección (`firestore.rules`)

Dos cambios:

1. **La regla de `create` ahora sí valida el contenido**, no solo el
   autor:
   ```
   function _hasSafeDefaultsOnCreate(data) {
     let noDefaultAllowed = ['permissions', 'subscription', 'isAdmin', 'customClaims'];
     return !data.keys().hasAny(noDefaultAllowed)
            && (!('role' in data) || data.role == 'user')
            && (!('premium' in data) || data.premium == false);
   }
   ```
   - `permissions`, `subscription`, `isAdmin`, `customClaims`: prohibidos
     por completo en la creación — no existe un valor de estos campos que
     tenga sentido que un cliente proponga.
   - `role`: permitido ÚNICAMENTE si el valor es exactamente `'user'`
     (o si el campo no aparece en absoluto).
   - `premium`: permitido ÚNICAMENTE si es exactamente `false`.

2. **La lista de campos protegidos en `update` se amplió** de
   `['role', 'premium']` (la propuesta original) a
   `['role', 'permissions', 'subscription', 'isAdmin', 'customClaims', 'premium']`
   — cerrando también los otros campos sensibles que el encargo de esta
   tarea identificó explícitamente.

Ver `firestore.rules` (raíz del proyecto) para el archivo completo.

## 5. Cómo se garantizan los valores seguros por defecto (punto 3 del encargo)

El documento inicial de un usuario se crea, en la práctica, sin el campo
`role` en absoluto (`UserModel.toMap()` en el cliente Flutter nunca lo
incluye — ver `lib/features/auth/data/models/user_model.dart`). La regla
de `create` lo permite (rama `!('role' in data)`), y cualquier lectura
posterior sin el campo cae a `UserRole.user` por el fallback ya
implementado en `UserModel.fromMap` (tarea A2). El resultado neto: todo
usuario nuevo es `user` de forma segura, sin que ni el cliente ni las
reglas tengan que "confiar" en que el valor por defecto se escriba
correctamente — la ausencia del campo ES el valor seguro.

## 6. Cómo se asignan roles elevados (punto 4 del encargo)

**Nunca desde el cliente.** El único camino para que un usuario pase a
`premium`, `coach` o `admin` es:
- Un script de administración con Firebase Admin SDK (que se ejecuta con
  privilegios de servidor y **se salta estas reglas por completo** — es
  el mecanismo de diseño de Firestore para operaciones administrativas),
  como el ya existente `firebase/scripts/backfill_user_roles.js`.
- Una Cloud Function con Admin SDK, activada por un evento de confianza
  (p. ej. un webhook de Stripe confirmando un pago de suscripción premium,
  o una acción explícita de un admin autenticado en el futuro panel de
  administración, verificada server-side).

Ningún flujo de este proyecto, hoy, asigna roles desde el cliente — es
una propiedad que se mantiene por la ausencia de código cliente que lo
intente, reforzada ahora también por la regla que lo bloquearía aunque
existiera.

## 7. Tests automatizados (punto 5 del encargo)

`firebase/rules-tests/firestore.rules.test.js` — suite completa contra el
emulador de Firestore, cubriendo exactamente los 4 ataques exigidos más
casos de control positivos (ver `firebase/rules-tests/README.md` para el
desglose completo y las instrucciones de ejecución).

## 8. Cómo verificar (pendiente — léase con atención)

**Estos tests NO se han ejecutado.** El entorno en el que se escribió esta
corrección tiene Node.js (v22), Java (OpenJDK 21) y npm disponibles — lo
que falta es **acceso a red**: `npm install` devuelve `403 Forbidden`
contra el registro de npm (política de la sandbox, no una limitación de
herramientas). Sin poder instalar `firebase-tools` ni las dependencias del
propio proyecto de tests (`@firebase/rules-unit-testing`, `firebase`,
`jest`), no hay forma de levantar el emulador ni correr la suite desde
aquí.

**Antes de dar por cerrada la tarea A3 y de desplegar `firestore.rules` a
producción**, es obligatorio:

```bash
cd firebase/rules-tests
npm install
npm test
```

y confirmar que la totalidad de los tests (~20) pasan. Si alguno falla,
**no desplegar** — revisar si la regla es demasiado laxa (dejó pasar un
ataque) o demasiado estricta (rompió un caso de control legítimo) antes
de corregir.

Este documento se actualizará con el resultado real de esa ejecución en
cuanto se corra en un entorno con las herramientas disponibles — hasta
entonces, la tarea A3 se considera **implementada pero no verificada**.
