import { HttpStatus } from '@nestjs/common';
import { ApiException } from '../exceptions/api.exception';
import { assertOwned } from './assert-owned.util';

describe('assertOwned', () => {
  const notFound = (): ApiException =>
    new ApiException(HttpStatus.NOT_FOUND, 'THING_NOT_FOUND', 'no existe');

  it('devuelve el recurso si pertenece al usuario', () => {
    const resource = { userId: 'user-1', name: 'bici' };
    expect(assertOwned(resource, 'user-1', notFound)).toBe(resource);
  });

  it('lanza el error dado si el recurso es null', () => {
    expect(() => assertOwned(null, 'user-1', notFound)).toThrow(
      expect.objectContaining({ code: 'THING_NOT_FOUND' }),
    );
  });

  it('lanza el error dado si el recurso pertenece a otro usuario (nunca 403)', () => {
    const resource = { userId: 'user-2', name: 'bici ajena' };
    expect(() => assertOwned(resource, 'user-1', notFound)).toThrow(
      expect.objectContaining({ code: 'THING_NOT_FOUND' }),
    );
  });
});
