import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { isPgUniqueViolation, pgConstraintName } from '../../common/database/pg-error.util';
import { PG_POOL } from '../../database/database.module';
import { FirebaseEmailConflictError } from './errors/firebase-email-conflict.error';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  displayName: string;
  photoUrl: string | null;
  ftp: number | null;
  weightKg: string | null;
  premium: boolean;
  emailVerified: boolean;
  authProvider: string;
  /** `NULL` para usuarios legacy (incluida la cuenta QA compartida) que
   * todavía no pasaron por el puente Firebase → NestJS (Fase 2/3). */
  firebaseUid: string | null;
  createdAt: Date;
}

/** Ver `UpsertByFirebaseUidParams.provider` — mismos 3 valores que ya
 * acepta el `CHECK` de `auth_provider` (migración 0001), sin necesidad de
 * ampliarlo: el llamador (Fase 3) normaliza los identificadores propios de
 * Firebase (`google.com`/`apple.com`/`password`) a estos antes de llamar
 * acá. Este repositorio no sabe nada de Firebase. */
export type FirebaseBackedAuthProvider = 'password' | 'google' | 'apple';

export interface UpsertByFirebaseUidResult {
  user: UserRecord;
  /** `true` si esta llamada creó la fila — usado por `AuthService` (Fase
   * 3) exclusivamente para el registro de auditoría (`audit_log.metadata.newUser`),
   * nunca para tomar decisiones de autorización. */
  isNew: boolean;
}

export interface UpsertByFirebaseUidParams {
  /**
   * Identidad estable — debe llegar EXCLUSIVAMENTE del claim `sub` de un
   * ID token de Firebase ya verificado por `firebase-admin` (Fase 3, sin
   * conectar todavía). Este repositorio no verifica tokens ni sabe de
   * dónde viene el valor — confía en que el llamador ya lo autenticó. Sin
   * ningún endpoint público que exponga este método todavía, no puede
   * llegar de un body sin validar.
   */
  firebaseUid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  provider: FirebaseBackedAuthProvider;
}

function mapRow(row: Record<string, unknown>): UserRecord {
  return {
    id: row.id as string,
    email: row.email as string,
    passwordHash: (row.password_hash as string | null) ?? null,
    displayName: row.display_name as string,
    photoUrl: (row.photo_url as string | null) ?? null,
    ftp: (row.ftp as number | null) ?? null,
    weightKg: (row.weight_kg as string | null) ?? null,
    premium: row.premium as boolean,
    emailVerified: row.email_verified as boolean,
    authProvider: row.auth_provider as string,
    firebaseUid: (row.firebase_uid as string | null) ?? null,
    createdAt: row.created_at as Date,
  };
}

/**
 * Acceso a `users`/`user_roles` vía `pg.Pool` directo — misma decisión sin
 * ORM ya tomada en C2 (ver `config/database.config.ts`), ahora con lógica
 * de negocio real encima.
 */
@Injectable()
export class UsersRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Case-insensitive a propósito, y respaldado por la base desde la
   * migración `0002_users_email_case_insensitive_unique.sql`
   * (`users_email_lower_unique`, índice ÚNICO sobre `LOWER(email)`) — el
   * `LOWER()` de acá es el camino rápido para el caso común (evita un
   * viaje a la base que sabemos que va a fallar), pero quien realmente
   * garantiza que "rider@x.com" y "Rider@x.com" no puedan coexistir bajo
   * concurrencia es la constraint de la base, no este chequeo. Ver
   * `AuthService.register` para la traducción del `23505` que la base
   * devuelve si dos registros concurrentes llegan a pasar este chequeo a
   * la vez.
   */
  async findByEmail(email: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL',
      [email],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL',
      [id],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /** Respaldado por `users_firebase_uid_unique` (migración 0005, único
   * PARCIAL — `WHERE firebase_uid IS NOT NULL`) — nunca puede devolver más
   * de una fila. */
  async findByFirebaseUid(firebaseUid: string): Promise<UserRecord | null> {
    const result = await this.pool.query(
      'SELECT * FROM users WHERE firebase_uid = $1 AND deleted_at IS NULL',
      [firebaseUid],
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  async createWithPassword(params: {
    email: string;
    passwordHash: string;
    displayName: string;
  }): Promise<UserRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        `INSERT INTO users (email, password_hash, display_name, auth_provider)
         VALUES ($1, $2, $3, 'password')
         RETURNING *`,
        [params.email, params.passwordHash, params.displayName],
      );
      const user = mapRow(userResult.rows[0]);
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, (SELECT id FROM roles WHERE name = 'user'))`,
        [user.id],
      );
      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findRoleNames(userId: string): Promise<string[]> {
    const result = await this.pool.query(
      `SELECT r.name FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1`,
      [userId],
    );
    return result.rows.map((row) => row.name as string);
  }

  /** `PATCH /users/me` (spec 1.2) — solo actualiza los campos presentes en
   * `updates`; los rangos (`ftp`/`weightKg`) ya se validaron en el DTO
   * (`UpdateProfileDto`), reflejando los mismos `CHECK` de
   * `migrations/0001_init.sql` para no depender de que Postgres rechace
   * el INSERT/UPDATE con un 500 genérico. */
  async updateProfile(
    userId: string,
    updates: { displayName?: string; ftp?: number; weightKg?: number },
  ): Promise<UserRecord | null> {
    const setClauses: string[] = [];
    const values: unknown[] = [userId];

    if (updates.displayName !== undefined) {
      values.push(updates.displayName);
      setClauses.push(`display_name = $${values.length}`);
    }
    if (updates.ftp !== undefined) {
      values.push(updates.ftp);
      setClauses.push(`ftp = $${values.length}`);
    }
    if (updates.weightKg !== undefined) {
      values.push(updates.weightKg);
      setClauses.push(`weight_kg = $${values.length}`);
    }

    if (setClauses.length === 0) {
      return this.findById(userId);
    }

    setClauses.push('updated_at = now()');
    const result = await this.pool.query(
      `UPDATE users SET ${setClauses.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING *`,
      values,
    );
    return result.rows[0] ? mapRow(result.rows[0]) : null;
  }

  /** `DELETE /users/me` (spec 1.2 / 5.6): soft delete — el borrado físico
   * es un job en segundo plano fuera del alcance de este endpoint. */
  async softDelete(userId: string): Promise<void> {
    await this.pool.query(
      'UPDATE users SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL',
      [userId],
    );
  }

  /**
   * Preparado en la Fase 2 del puente Firebase → NestJS → PostgreSQL
   * (documento de diseño, Fase 1) — **todavía sin ningún endpoint que lo
   * llame** (eso es la Fase 3, cuando exista `firebase-admin` verificando
   * tokens de verdad). No tocar la política de colisión de acá sin
   * autorización explícita:
   *
   * - La identidad estable es `firebase_uid`, NUNCA el email — nunca se
   *   fusiona un usuario existente por coincidencia de email.
   * - Si no existe ninguna fila con este `firebase_uid` pero SÍ existe una
   *   fila con el mismo email (sin vincular a este `firebase_uid`), se
   *   lanza {@link FirebaseEmailConflictError} — nunca un merge en
   *   silencio.
   * - Un usuario NUEVO siempre se crea con el rol `user` por defecto,
   *   igual que `createWithPassword` — los roles nunca vienen de datos
   *   externos (ni del token de Firebase ni de este método).
   * - Un usuario EXISTENTE nunca ve tocado su `password_hash` (ni
   *   siquiera se menciona en el `UPDATE`) ni sus roles — solo
   *   `email`/`email_verified`/`display_name`/`auth_provider`.
   *
   * Nota de concurrencia (mismo principio ya documentado en
   * `migrations/0002_users_email_case_insensitive_unique.sql`) — Fase 4.1,
   * cerrado con evidencia real (`docs/audits/AUDITORIA_FINAL/fase_4_1/`):
   * el chequeo `findByFirebaseUid`/`findByEmail` de acá es el camino rápido
   * para el caso común, no la única garantía — dos llamadas concurrentes
   * para el mismo `firebase_uid` (mismo usuario reintentando el exchange
   * casi al mismo tiempo, típico multi-instancia en Cloud Run) pueden pasar
   * ambas el chequeo y competir en el `INSERT`; quien realmente lo impide es
   * una de las 3 constraints únicas de `users` (`users_firebase_uid_unique`,
   * `users_email_unique`, `users_email_lower_unique` — error Postgres
   * `23505`). Verificado empíricamente (10 inserts concurrentes reales, no
   * simulado): cuando la carrera es por el mismo `firebase_uid`, Postgres
   * SIEMPRE reporta `users_email_unique` (se creó primero, en la migración
   * 0001) — nunca `users_firebase_uid_unique` — porque en ese caso el email
   * también es idéntico. Por eso el nombre de la constraint por sí solo NO
   * alcanza para distinguir "es la misma persona reintentando" de "es un
   * conflicto real de email entre dos cuentas Firebase distintas": la
   * constraint solo habilita el manejo controlado (evita capturar
   * `23505` de cualquier otra tabla/constraint); quien decide es la
   * re-consulta por `firebase_uid` de abajo — si ya existe, ganó una
   * carrera legítima; si no, es un conflicto real de email.
   */
  async upsertByFirebaseUid(
    params: UpsertByFirebaseUidParams,
  ): Promise<UpsertByFirebaseUidResult> {
    const existingByUid = await this.findByFirebaseUid(params.firebaseUid);
    if (existingByUid) {
      const result = await this.pool.query(
        `UPDATE users
         SET email = $2, email_verified = $3, display_name = $4, auth_provider = $5, updated_at = now()
         WHERE firebase_uid = $1 AND deleted_at IS NULL
         RETURNING *`,
        [
          params.firebaseUid,
          params.email,
          params.emailVerified,
          params.displayName,
          params.provider,
        ],
      );
      return { user: mapRow(result.rows[0]), isNew: false };
    }

    const existingByEmail = await this.findByEmail(params.email);
    if (existingByEmail) {
      // Misma ventana de carrera que el `catch` de abajo, pero ANTES de
      // llegar a la transacción: entre el `findByFirebaseUid` de arriba
      // (todavía no existía) y este `findByEmail`, otra solicitud
      // concurrente para el MISMO `firebaseUid` pudo haber terminado de
      // insertar y confirmar — acá se ve como "ya existe alguien con este
      // email", pero si ese alguien es exactamente este `firebaseUid`, no
      // es un conflicto real, es la misma carrera legítima que el resto
      // del método ya maneja. Un email de otra cuenta (`firebaseUid`
      // distinto, o `null` en una cuenta legacy de password) sigue siendo
      // el conflicto real de siempre.
      if (existingByEmail.firebaseUid === params.firebaseUid) {
        return { user: existingByEmail, isNew: false };
      }
      throw new FirebaseEmailConflictError(params.email);
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const userResult = await client.query(
        `INSERT INTO users (email, display_name, email_verified, auth_provider, firebase_uid)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [params.email, params.displayName, params.emailVerified, params.provider, params.firebaseUid],
      );
      const user = mapRow(userResult.rows[0]);
      await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         VALUES ($1, (SELECT id FROM roles WHERE name = 'user'))`,
        [user.id],
      );
      await client.query('COMMIT');
      return { user, isNew: true };
    } catch (error) {
      await client.query('ROLLBACK');

      // Solo estas 3 constraints — nunca cualquier `23505` — habilitan el
      // manejo controlado de abajo. Cuál de las 3 reportó Postgres NO
      // decide el resultado (ver docblock del método): solo filtra que el
      // conflicto sea realmente sobre `users`, antes de pagar el costo de
      // la re-consulta.
      const constraint = isPgUniqueViolation(error) ? pgConstraintName(error) : null;
      const isExpectedUsersConstraint =
        constraint === 'users_firebase_uid_unique' ||
        constraint === 'users_email_unique' ||
        constraint === 'users_email_lower_unique';

      if (isExpectedUsersConstraint) {
        // La existencia posterior del mismo `firebase_uid` es el único
        // criterio real: si aparece, otra solicitud concurrente ganó la
        // carrera por identidad (idempotente, se devuelve su fila); si no
        // aparece, la colisión fue por email contra una cuenta distinta —
        // conflicto real, mismo error que ya lanza el chequeo rápido de
        // arriba para el caso no concurrente.
        const winner = await this.findByFirebaseUid(params.firebaseUid);
        if (winner) {
          return { user: winner, isNew: false };
        }
        throw new FirebaseEmailConflictError(params.email);
      }

      throw error;
    } finally {
      client.release();
    }
  }
}
