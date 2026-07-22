import { Module } from '@nestjs/common';
import { EquipmentController } from './equipment.controller';
import { EquipmentRepository } from './equipment.repository';
import { EquipmentService } from './equipment.service';

/**
 * `POST/GET/PATCH/DELETE /equipment` (Bloque D, D1) — sin dependencias de
 * otros módulos de dominio (ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md
 * sección 8, "cero dependencias" es la razón #1 para priorizarlo
 * primero). No exporta nada todavía — ningún otro módulo lo necesita
 * hasta D5 (Actividades), fuera de alcance de esta tarea.
 */
@Module({
  controllers: [EquipmentController],
  providers: [EquipmentRepository, EquipmentService],
})
export class EquipmentModule {}
