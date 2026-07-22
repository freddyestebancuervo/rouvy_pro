import { Module } from '@nestjs/common';
import { WorkoutsController } from './workouts.controller';
import { WorkoutsRepository } from './workouts.repository';
import { WorkoutsService } from './workouts.service';

/**
 * `POST/GET/GET:id/PATCH/DELETE /workouts` (Bloque D, D2) — sin
 * dependencias de otros módulos de dominio. No exporta nada todavía;
 * `WorkoutsRepository` lo necesitará D5 (Actividades) para
 * `workout_id`/`workout_name_snapshot`, fuera de alcance de esta tarea.
 */
@Module({
  controllers: [WorkoutsController],
  providers: [WorkoutsRepository, WorkoutsService],
})
export class WorkoutsModule {}
