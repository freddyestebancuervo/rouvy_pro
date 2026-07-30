import {
  isPgUniqueViolation,
  isPoolConnectionTimeout,
  pgConstraintName,
  pgErrorCode,
} from './pg-error.util';

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

  describe('isPoolConnectionTimeout', () => {
    it('true para el error exacto de pg-pool (mensaje exacto, sin .code)', () => {
      expect(isPoolConnectionTimeout(new Error('timeout exceeded when trying to connect'))).toBe(true);
    });

    it('false si el mensaje no coincide exactamente, aunque sea similar', () => {
      expect(isPoolConnectionTimeout(new Error('timeout exceeded when trying to connect to replica'))).toBe(
        false,
      );
      expect(isPoolConnectionTimeout(new Error('Timeout exceeded when trying to connect'))).toBe(false);
    });

    it('false para cualquier error de Postgres real, aunque el mensaje coincida (siempre trae .code)', () => {
      const errorWithSameMessage = Object.assign(
        new Error('timeout exceeded when trying to connect'),
        { code: '57014' }, // query_canceled — cualquier SQLSTATE real alcanza para excluirlo
      );
      expect(isPoolConnectionTimeout(errorWithSameMessage)).toBe(false);
    });

    it('false para valores que no son Error', () => {
      expect(isPoolConnectionTimeout('timeout exceeded when trying to connect')).toBe(false);
      expect(isPoolConnectionTimeout(null)).toBe(false);
      expect(isPoolConnectionTimeout(undefined)).toBe(false);
      expect(isPoolConnectionTimeout({ message: 'timeout exceeded when trying to connect' })).toBe(false);
    });
  });
});
