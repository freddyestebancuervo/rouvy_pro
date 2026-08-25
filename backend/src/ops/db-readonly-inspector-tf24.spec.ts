import {
  EXPECTED_MIGRATION_NAMES,
  expectedObjectsForApplied,
} from './db-readonly-inspector';

describe('T-F2.4 — 0007_drop_unused_ride_sessions', () => {
  it('models 0007 as removing ride_sessions and all of its physical objects', () => {
    expect(EXPECTED_MIGRATION_NAMES[EXPECTED_MIGRATION_NAMES.length - 1]).toBe('0007_drop_unused_ride_sessions');
    const expected = expectedObjectsForApplied([...EXPECTED_MIGRATION_NAMES]);

    expect(expected.tables.has('ride_sessions')).toBe(false);
    expect(expected.indexes.has('idx_ride_sessions_user_start')).toBe(false);
    expect(expected.indexes.has('ride_sessions_pkey')).toBe(false);
    expect([...expected.columns].some((column) => column.startsWith('ride_sessions.'))).toBe(false);

    expect(expected.tables.has('users')).toBe(true);
    expect(expected.tables.has('audit_log')).toBe(true);
    expect(expected.indexes.has('users_pkey')).toBe(true);
  });
});
