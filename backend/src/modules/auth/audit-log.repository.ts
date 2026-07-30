import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

/**
 * Primer punto de escritura real de `audit_log` (tabla definida desde
 * `migrations/0001_init.sql`, sin ningún consumidor hasta ahora — Fase 3
 * del puente Firebase → NestJS → PostgreSQL). Deliberadamente mínimo: un
 * único método genérico, sin abstracciones para eventos que todavía no
 * existen.
 *
 * `metadata` nunca debe llevar el ID token de Firebase completo ni el
 * `firebase_uid` — ver el único llamador hoy
 * (`AuthService.exchangeFirebaseToken`), que solo registra
 * `provider`/`newUser`.
 */
@Injectable()
export class AuditLogRepository {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async record(
    action: string,
    userId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_log (user_id, action, metadata) VALUES ($1, $2, $3)`,
      [userId, action, metadata],
    );
  }
}
