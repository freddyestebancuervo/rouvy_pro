import { Module } from '@nestjs/common';

/**
 * Vacío a propósito — la tarea C2 (este scaffold) solo deja la
 * estructura de carpetas/módulos lista. Los endpoints reales
 * (`POST /auth/register`, `POST /auth/login`, siguiendo el contrato
 * exacto de docs/TECHNICAL_SPECIFICATION_M0_M1.md sección 1.2) son la
 * tarea C3.
 *
 * Estructura esperada al completar C3 (siguiendo el mismo patrón de
 * capas ya usado en el cliente Flutter — domain/application/infrastructure,
 * ver documento de arquitectura general):
 *   auth/
 *     domain/           — entidades de dominio del backend (no las de Flutter)
 *     application/       — casos de uso (RegisterUserUseCase, LoginUseCase...)
 *     infrastructure/
 *       auth.controller.ts
 *       auth.service.ts
 *       dto/
 *         register.dto.ts
 *         login.dto.ts
 */
@Module({})
export class AuthModule {}
