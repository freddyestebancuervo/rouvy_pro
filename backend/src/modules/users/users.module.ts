import { Module } from '@nestjs/common';

/**
 * Vacío a propósito, igual que `AuthModule` — ver su docblock. Los
 * endpoints de este módulo (`GET/PATCH/DELETE /users/me`, y más adelante
 * `GET /admin/users` de la tarea D1) se implementan cuando C3 esté
 * completa y haya un mecanismo de autenticación real (guard de JWT) que
 * proteja estas rutas.
 */
@Module({})
export class UsersModule {}
