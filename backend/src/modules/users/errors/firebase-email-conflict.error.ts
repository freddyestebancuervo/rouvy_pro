/**
 * Se lanza desde `UsersRepository.upsertByFirebaseUid` cuando el email de
 * una identidad Firebase coincide con una fila de `users` ya existente que
 * no está vinculada a ese mismo `firebase_uid` (documento de diseño Fase 1
 * del puente Firebase → NestJS → PostgreSQL, política de colisión — no
 * modificar sin autorización explícita: `firebase_uid` es la única
 * identidad estable, el email nunca fusiona usuarios automáticamente).
 *
 * La traducción a una respuesta HTTP (p. ej. `409 FIREBASE_EMAIL_CONFLICT`)
 * queda para la capa de servicio que use este repositorio — todavía no
 * existe (Fase 3, endpoint `/auth/firebase/exchange`).
 */
export class FirebaseEmailConflictError extends Error {
  constructor(public readonly email: string) {
    super(
      `Ya existe un usuario con el email "${email}" que no está vinculado a esta identidad de Firebase.`,
    );
    this.name = 'FirebaseEmailConflictError';
  }
}
