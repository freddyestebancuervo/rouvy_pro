import {
  ALL_REQUIRED_DEPLOYER_PERMISSIONS,
  STAGE1_REQUIRED_PERMISSIONS,
  STAGE2_REQUIRED_PERMISSIONS,
  CLEANUP_REQUIRED_PERMISSIONS,
  READINESS_GATE_META_PERMISSIONS,
  FORBIDDEN_DEPLOYER_PERMISSIONS,
  PROPOSED_HARDENER_ORCHESTRATOR_ROLE,
  EXPECTED_ALL_REQUIRED_DEPLOYER_PERMISSIONS_COUNT,
  EXPECTED_PROPOSED_ROLE_PERMISSION_COUNT,
  evaluatePermissionSufficiency,
} from './production-hardener-required-permissions';

/**
 * TF12-POINT8C-IAM-P1 — pruebas del manifiesto en sí (nunca contra GCP real
 * — ver hardener-workflow-contract.spec.ts para la prueba de que el array
 * bash duplicado en el workflow coincide con este mismo manifiesto).
 */

describe('production-hardener-required-permissions — manifiesto exacto (Fase 1/3/6)', () => {
  it('ALL_REQUIRED_DEPLOYER_PERMISSIONS tiene exactamente 10 permisos — ni más ni menos', () => {
    expect(ALL_REQUIRED_DEPLOYER_PERMISSIONS).toHaveLength(EXPECTED_ALL_REQUIRED_DEPLOYER_PERMISSIONS_COUNT);
    expect(ALL_REQUIRED_DEPLOYER_PERMISSIONS).toHaveLength(10);
  });

  it('el conjunto exacto de 10 permisos coincide byte a byte con el determinado por la investigación de causa raíz', () => {
    expect([...ALL_REQUIRED_DEPLOYER_PERMISSIONS].sort()).toEqual(
      [
        'cloudsql.users.create',
        'cloudsql.users.delete',
        'cloudsql.users.get',
        'cloudsql.users.update',
        'secretmanager.secrets.create',
        'secretmanager.secrets.delete',
        'secretmanager.secrets.get',
        'secretmanager.secrets.getIamPolicy',
        'secretmanager.secrets.setIamPolicy',
        'secretmanager.versions.add',
      ].sort(),
    );
  });

  it('cloudsql.users.list NUNCA aparece en el manifiesto — ningún comando real del workflow lo requiere hoy', () => {
    expect(ALL_REQUIRED_DEPLOYER_PERMISSIONS).not.toContain('cloudsql.users.list');
  });

  it('secretmanager.versions.access NUNCA aparece en el manifiesto operativo, y está explícitamente prohibido', () => {
    expect(ALL_REQUIRED_DEPLOYER_PERMISSIONS).not.toContain('secretmanager.versions.access');
    expect(FORBIDDEN_DEPLOYER_PERMISSIONS).toContain('secretmanager.versions.access');
  });

  it('ninguna permission de gestión de bases de datos (cloudsql.databases.*) aparece en el manifiesto', () => {
    for (const permission of ALL_REQUIRED_DEPLOYER_PERMISSIONS) {
      expect(permission.startsWith('cloudsql.databases.')).toBe(false);
    }
  });

  it('ninguna permission de rotación/tag-binding de Secret Manager (fuera del alcance operativo) aparece en el manifiesto', () => {
    const outOfScope = ['secretmanager.secrets.rotate', 'secretmanager.secrets.enableManagedRotation', 'secretmanager.secrets.createTagBinding'];
    for (const permission of outOfScope) {
      expect(ALL_REQUIRED_DEPLOYER_PERMISSIONS).not.toContain(permission);
    }
  });

  it('STAGE1_REQUIRED_PERMISSIONS nunca incluye cloudsql.users.delete ni cloudsql.users.update — Stage 1 nunca borra ni muta roles del target', () => {
    expect(STAGE1_REQUIRED_PERMISSIONS).not.toContain('cloudsql.users.delete');
    expect(STAGE1_REQUIRED_PERMISSIONS).not.toContain('cloudsql.users.update');
  });

  it('STAGE2_REQUIRED_PERMISSIONS incluye cloudsql.users.update — el único permiso que habilita remove-target-cloudsqlsuperuser', () => {
    expect(STAGE2_REQUIRED_PERMISSIONS).toContain('cloudsql.users.update');
  });

  it('CLEANUP_REQUIRED_PERMISSIONS incluye delete tanto de Cloud SQL users como de Secret Manager secrets — cleanup nunca depende únicamente de los permisos de creación', () => {
    expect(CLEANUP_REQUIRED_PERMISSIONS).toContain('cloudsql.users.delete');
    expect(CLEANUP_REQUIRED_PERMISSIONS).toContain('secretmanager.secrets.delete');
    // Explícitamente NUNCA los permisos de creación — cleanup no crea nada.
    expect(CLEANUP_REQUIRED_PERMISSIONS).not.toContain('cloudsql.users.create');
    expect(CLEANUP_REQUIRED_PERMISSIONS).not.toContain('secretmanager.secrets.create');
  });

  it('cada permission de cada sub-manifiesto (Stage1/Stage2/Cleanup) está también en ALL_REQUIRED_DEPLOYER_PERMISSIONS — nunca una lista diverge de la unión', () => {
    for (const permission of [...STAGE1_REQUIRED_PERMISSIONS, ...STAGE2_REQUIRED_PERMISSIONS, ...CLEANUP_REQUIRED_PERMISSIONS]) {
      expect(ALL_REQUIRED_DEPLOYER_PERMISSIONS).toContain(permission);
    }
  });

  it('ALL_REQUIRED_DEPLOYER_PERMISSIONS no contiene duplicados', () => {
    expect(new Set(ALL_REQUIRED_DEPLOYER_PERMISSIONS).size).toBe(ALL_REQUIRED_DEPLOYER_PERMISSIONS.length);
  });
});

describe('READINESS_GATE_META_PERMISSIONS (Fase 2)', () => {
  it('contiene exactamente resourcemanager.projects.getIamPolicy e iam.roles.get — determinado por investigación en vivo, nunca asumido', () => {
    expect([...READINESS_GATE_META_PERMISSIONS].sort()).toEqual(['iam.roles.get', 'resourcemanager.projects.getIamPolicy'].sort());
  });

  it('NO incluye iam.serviceAccounts.getIamPolicy — el gate no re-verifica el binding actAs sobre MIGRATION_EXECUTOR_SA en cada dispatch (ya probado suficiente; solución más angosta posible)', () => {
    expect(READINESS_GATE_META_PERMISSIONS).not.toContain('iam.serviceAccounts.getIamPolicy');
  });

  it('no se solapa con ALL_REQUIRED_DEPLOYER_PERMISSIONS — son categorías distintas (operativo vs. auto-verificación)', () => {
    for (const meta of READINESS_GATE_META_PERMISSIONS) {
      expect(ALL_REQUIRED_DEPLOYER_PERMISSIONS).not.toContain(meta);
    }
  });
});

describe('PROPOSED_HARDENER_ORCHESTRATOR_ROLE — artefacto revisado, nunca aplicado (Fase 6)', () => {
  it('el roleId es exactamente korixaProductionDbHardenerOrchestrator', () => {
    expect(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.roleId).toBe('korixaProductionDbHardenerOrchestrator');
  });

  it('incluye exactamente 12 permisos: los 10 operativos + las 2 meta-permissions del gate, sin exceso', () => {
    expect(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.includedPermissions).toHaveLength(EXPECTED_PROPOSED_ROLE_PERMISSION_COUNT);
    expect(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.includedPermissions).toHaveLength(12);
  });

  it('la unión de permisos operativos + meta es exactamente el conjunto de includedPermissions, sin duplicados ni faltantes', () => {
    const expected = new Set([...ALL_REQUIRED_DEPLOYER_PERMISSIONS, ...READINESS_GATE_META_PERMISSIONS]);
    expect(new Set(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.includedPermissions)).toEqual(expected);
  });

  it('nunca incluye secretmanager.versions.access', () => {
    expect(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.includedPermissions).not.toContain('secretmanager.versions.access');
  });

  it('nunca incluye ninguna permission cloudsql.databases.* (creación/borrado de bases de datos)', () => {
    for (const permission of PROPOSED_HARDENER_ORCHESTRATOR_ROLE.includedPermissions) {
      expect(permission.startsWith('cloudsql.databases.')).toBe(false);
    }
  });

  it('la descripción documenta explícitamente por qué excluye versions.access y las permissions de bases de datos — nunca solo el código, también la intención revisable por un humano', () => {
    expect(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.description).toMatch(/secretmanager\.versions\.access/);
    expect(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.description.toLowerCase()).toMatch(/database/);
  });
});

describe('evaluatePermissionSufficiency — función pura de comparación (Fase 4/2)', () => {
  it('reporta sufficient=false y lista TODOS los 12 permisos como missing cuando el conjunto otorgado está vacío (el estado REAL actual de Producción)', () => {
    const report = evaluatePermissionSufficiency(new Set());
    expect(report.sufficient).toBe(false);
    expect(report.missing).toHaveLength(12);
  });

  it('reporta sufficient=true cuando el conjunto otorgado es exactamente el rol propuesto completo', () => {
    const report = evaluatePermissionSufficiency(new Set(PROPOSED_HARDENER_ORCHESTRATOR_ROLE.includedPermissions));
    expect(report.sufficient).toBe(true);
    expect(report.missing).toHaveLength(0);
    expect(report.forbiddenButPresent).toHaveLength(0);
  });

  it('reporta sufficient=false y forbiddenButPresent no vacío si, por error, secretmanager.versions.access estuviera presente — incluso con todo lo demás correcto', () => {
    const granted = new Set([...PROPOSED_HARDENER_ORCHESTRATOR_ROLE.includedPermissions, 'secretmanager.versions.access']);
    const report = evaluatePermissionSufficiency(granted);
    expect(report.sufficient).toBe(false);
    expect(report.forbiddenButPresent).toEqual(['secretmanager.versions.access']);
  });

  it('reporta exactamente cuáles faltan cuando el conjunto otorgado es parcial (reproduce el estado real actual: solo las permissions read-only ya existentes)', () => {
    const currentRealGrantedPermissions = new Set([
      // korixaProductionMetadataReader, tal como existe HOY en Producción — ninguna de estas cubre el manifiesto.
      'artifactregistry.dockerimages.list',
      'cloudsql.databases.list',
      'cloudsql.instances.get',
      'iam.serviceAccounts.get',
      'run.jobs.get',
      'secretmanager.versions.get',
      'secretmanager.versions.list',
      // roles/run.developer (permisos relevantes)
      'run.jobs.create',
      'run.jobs.delete',
      'run.jobs.run',
      'run.jobs.update',
      'resourcemanager.projects.get',
      'resourcemanager.projects.list',
    ]);
    const report = evaluatePermissionSufficiency(currentRealGrantedPermissions);
    expect(report.sufficient).toBe(false);
    expect([...report.missing].sort()).toEqual([...ALL_REQUIRED_DEPLOYER_PERMISSIONS, ...READINESS_GATE_META_PERMISSIONS].sort());
  });
});
