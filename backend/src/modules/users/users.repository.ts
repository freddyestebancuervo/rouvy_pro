import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

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
  createdAt: Date;
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
}
