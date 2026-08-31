/**
 * Runtime privilege matrix (T-F1.2 — KORIXA_TF12_PRIVILEGE_MODEL_REMEDIATION).
 *
 * Única fuente de verdad, importada tanto por `privilege-reconciler.ts`
 * (para saber exactamente qué otorgar) como por `db-readonly-inspector.ts`
 * (para saber exactamente qué esperar y detectar drift) — evita que ambos
 * archivos diverjan silenciosamente con el tiempo.
 *
 * Deny-by-default + allowlist explícita por tabla/operación: cualquier
 * tabla/columna/secuencia que NO aparezca acá con un privilegio en
 * `true` nunca lo recibe del reconciliador y cualquier privilegio real
 * detectado fuera de esta matriz es DRIFT para el inspector — nunca un
 * `GRANT ALL` seguido de `REVOKE` selectivo (ver header de
 * `privilege-reconciler.ts` para el razonamiento completo de por qué esa
 * alternativa es estructuralmente insegura para `pgmigrations`).
 *
 * Cada entrada declara su propia evidencia (`PROVEN_BY_CODE` con la cita
 * exacta del repositorio/método que la sustenta) — ningún privilegio se
 * aprueba solo como `INFERRED`. Derivado exhaustivamente de:
 *   - src/modules/users/users.repository.ts
 *   - src/modules/refresh-tokens/refresh-tokens.repository.ts
 *   - src/modules/equipment/equipment.repository.ts
 *   - src/modules/workouts/workouts.repository.ts
 *   - src/modules/auth/audit-log.repository.ts
 * más un `grep -rn "DELETE FROM" src/` (cero resultados: ninguna tabla de
 * aplicación recibe DELETE físico del runtime — todo borrado es soft
 * delete vía UPDATE de una columna `*_at`, excepto `audit_log`, que es
 * exclusivamente INSERT).
 *
 * `pgmigrations`/`pgmigrations_id_seq` (objetos propios del motor de
 * `node-pg-migrate`, no de las migraciones de este repo) NO aparecen en
 * ninguna matriz — ausencia estructural, no un `REVOKE` posterior.
 */

export type TablePrivilegeVerb = 'select' | 'insert' | 'update' | 'delete';

export interface TablePrivilegeEntry {
  select: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  /** Evidencia obligatoria — nunca `INFERRED` para un privilegio en `true`. */
  evidence: string;
}

export interface SequencePrivilegeEntry {
  usage: boolean;
  evidence: string;
}

export const RUNTIME_TABLE_PRIVILEGE_MATRIX: Record<string, TablePrivilegeEntry> = {
  users: {
    select: true,
    insert: true,
    update: true,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: UsersRepository — SELECT (findByEmail/findById/findByFirebaseUid/findIdentityCandidates), ' +
      'INSERT (createWithPassword/upsertByFirebaseUid), UPDATE (updateProfile/softDelete/upsertByFirebaseUid). ' +
      'Cero DELETE físico — softDelete() es un UPDATE de deleted_at.',
  },
  roles: {
    select: true,
    insert: false,
    update: false,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: UsersRepository.createWithPassword/upsertByFirebaseUid (subquery "SELECT id FROM roles WHERE name = \'user\'") ' +
      'y findRoleNames (JOIN) — solo SELECT. Datos de referencia estáticos, sembrados una única vez por 0001_init.sql; ' +
      'ningún código de aplicación los inserta/modifica/borra.',
  },
  user_roles: {
    select: true,
    insert: true,
    update: false,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: UsersRepository.findRoleNames = SELECT; createWithPassword/upsertByFirebaseUid = INSERT. ' +
      'Cero UPDATE/DELETE en todo el árbol de código.',
  },
  refresh_tokens: {
    select: true,
    insert: true,
    update: true,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: RefreshTokensRepository — SELECT (rotate, "FOR UPDATE"), INSERT (create/rotate), ' +
      'UPDATE (revokeAllForUser/revokeOne/rotate, todos escriben revoked_at). Cero DELETE físico.',
  },
  equipment: {
    select: true,
    insert: true,
    update: true,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: EquipmentRepository — SELECT (findById/findAllForUser/findPageForUser/update sin cambios/applyDefault), ' +
      'INSERT (create), UPDATE (create con isDefault/update/archive/applyDefault). ' +
      'Cero DELETE físico — archive() es un UPDATE de archived_at.',
  },
  equipment_categories: {
    select: true,
    insert: false,
    update: false,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: EquipmentRepository.categoryExists = SELECT únicamente. Datos de referencia estáticos, ' +
      'sembrados una única vez por 0003_equipment.sql.',
  },
  workouts: {
    select: true,
    insert: true,
    update: true,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: WorkoutsRepository — SELECT (findById/findAllForUser/findPageForUser/findIntervalsForWorkout join implícito), ' +
      'INSERT (create), UPDATE (update/archive, ambos escriben updated_at). Cero DELETE físico.',
  },
  workout_intervals: {
    select: true,
    insert: true,
    update: false,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: WorkoutsRepository.findIntervalsForWorkout = SELECT; create() = INSERT. ' +
      'Documentado explícitamente como inmutables tras su creación (docblock de WorkoutsRepository.update) — ' +
      'cero UPDATE/DELETE en todo el árbol de código.',
  },
  audit_log: {
    select: false,
    insert: true,
    update: false,
    delete: false,
    evidence:
      'PROVEN_BY_CODE: AuditLogRepository.record = INSERT únicamente. `grep -rn "audit_log" src/` confirma que ' +
      'ningún otro archivo de src/ referencia esta tabla — append-only, cero SELECT/UPDATE/DELETE en todo el backend.',
  },
};

export const RUNTIME_SEQUENCE_PRIVILEGE_MATRIX: Record<string, SequencePrivilegeEntry> = {
  audit_log_id_seq: {
    usage: true,
    evidence:
      'PROVEN_BY_CODE: audit_log.id es BIGSERIAL (0001_init.sql) y AuditLogRepository.record() hace ' +
      'INSERT sin especificar id, dependiendo del DEFAULT nextval(audit_log_id_seq) — USAGE es lo único que ' +
      'PostgreSQL exige para invocar nextval(); ningún código llama SELECT/currval() directo sobre la secuencia, ' +
      'así que no se otorga SELECT.',
  },
  // Ninguna otra tabla de aplicación usa una secuencia real: todos los
  // demás PK son UUID con DEFAULT gen_random_uuid() (función core de
  // PostgreSQL 13+, ejecutable por PUBLIC sin ningún GRANT — ver
  // migrations/0001_init.sql). `pgmigrations_id_seq` (motor de
  // node-pg-migrate) deliberadamente NO aparece acá.
};

/** Aplana la matriz de tablas al formato `table:<nombre>:<verbo>` — usado
 * tanto para construir los GRANT del reconciliador como para el
 * comparador de drift del inspector, siempre en el mismo orden estable. */
export function flattenExpectedTablePrivileges(): string[] {
  const out: string[] = [];
  for (const [table, entry] of Object.entries(RUNTIME_TABLE_PRIVILEGE_MATRIX)) {
    (['select', 'insert', 'update', 'delete'] as const).forEach((verb) => {
      if (entry[verb]) out.push(`table:${table}:${verb}`);
    });
  }
  return out;
}

export function flattenExpectedSequencePrivileges(): string[] {
  const out: string[] = [];
  for (const [sequence, entry] of Object.entries(RUNTIME_SEQUENCE_PRIVILEGE_MATRIX)) {
    if (entry.usage) out.push(`sequence:${sequence}:usage`);
  }
  return out;
}
