import { isPgUniqueViolation, pgConstraintName, pgErrorCode } from './pg-error.util';

describe('pg-error.util', () => {
  describe('pgErrorCode', () => {
    it('devuelve el código si el error lo tiene', () => {
      expect(pgErrorCode({ code: '23505' })).toBe('23505');
    });

    it('devuelve null para valores sin forma de error de pg', () => {
      expect(pgErrorCode(null)).toBeNull();
      expect(pgErrorCode(undefined)).toBeNull();
      expect(pgErrorCode('boom')).toBeNull();
      expect(pgErrorCode(new Error('boom'))).toBeNull();
      expect(pgErrorCode({ code: 123 })).toBeNull();
    });
  });

  describe('pgConstraintName', () => {
    it('devuelve el nombre de la constraint si está presente', () => {
      expect(pgConstraintName({ constraint: 'users_email_lower_unique' })).toBe('users_email_lower_unique');
    });

    it('devuelve null si no hay constraint', () => {
      expect(pgConstraintName({ code: '23505' })).toBeNull();
      expect(pgConstraintName(null)).toBeNull();
    });
  });

  describe('isPgUniqueViolation', () => {
    it('true solo para code 23505', () => {
      expect(isPgUniqueViolation({ code: '23505' })).toBe(true);
      expect(isPgUniqueViolation({ code: '23503' })).toBe(false);
      expect(isPgUniqueViolation(new Error('boom'))).toBe(false);
    });
  });
});
