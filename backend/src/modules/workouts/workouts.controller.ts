import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AuthUser } from '../../common/auth/auth-user.interface';
import { CurrentUser } from '../../common/auth/current-user.decorator';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CreateWorkoutDto } from './dto/create-workout.dto';
import { UpdateWorkoutDto } from './dto/update-workout.dto';
import { WorkoutQueryDto } from './dto/workout-query.dto';
import {
  WorkoutDetailResponse,
  WorkoutListItemResponse,
  WorkoutsService,
} from './workouts.service';

/**
 * Bloque D, tarea D2 — ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md
 * sección 3. A diferencia de Equipment (D1), `GET` no es estrictamente
 * `/me`-scoped: expone catálogo y workouts públicos de otros usuarios
 * (0.1.6 documenta esta excepción explícita). Las escrituras
 * (`PATCH`/`DELETE`) sí siguen siendo estrictamente del dueño.
 */
@Controller('workouts')
@UseGuards(JwtAuthGuard)
export class WorkoutsController {
  constructor(private readonly workoutsService: WorkoutsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateWorkoutDto,
  ): Promise<WorkoutDetailResponse> {
    return this.workoutsService.create(user.userId, dto);
  }

  /**
   * T-F0.5 Enforcement (docs/tasks/TF0_5_PAGINATION_CONTRACT.md §6.3) —
   * mismo criterio que `EquipmentController.list`: el listado SIEMPRE
   * pasa por el modo paginado, incluso sin `limit`/`cursor`
   * (`parseLimit(undefined)` aplica `DEFAULT_LIMIT=50`, contract §9.1).
   * Body siempre `ARRAY`, cursor exclusivamente en `X-Next-Cursor`.
   */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: WorkoutQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WorkoutListItemResponse[]> {
    const page = await this.workoutsService.listPaginated(user.userId, query);
    if (page.nextCursor !== null) {
      res.setHeader('X-Next-Cursor', page.nextCursor);
    }
    return page.items;
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<WorkoutDetailResponse> {
    return this.workoutsService.getById(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkoutDto,
  ): Promise<WorkoutDetailResponse> {
    return this.workoutsService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.workoutsService.archive(user.userId, id);
  }
}
