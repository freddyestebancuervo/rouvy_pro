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
import { CreateEquipmentDto } from './dto/create-equipment.dto';
import { EquipmentQueryDto } from './dto/equipment-query.dto';
import { UpdateEquipmentDto } from './dto/update-equipment.dto';
import { EquipmentResponse, EquipmentService } from './equipment.service';

/**
 * Bloque D, tarea D1 — ver docs/TECHNICAL_SPECIFICATION_BLOQUE_D.md
 * sección 2. Todo el módulo es `/me`-scoped (0.1.6): un usuario nunca ve
 * ni modifica equipamiento de otro, sin excepción en este bloque.
 */
@Controller('equipment')
@UseGuards(JwtAuthGuard)
export class EquipmentController {
  constructor(private readonly equipmentService: EquipmentService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateEquipmentDto): Promise<EquipmentResponse> {
    return this.equipmentService.create(user.userId, dto);
  }

  /**
   * T-F0.5 (docs/tasks/TF0_5_PAGINATION_CONTRACT.md) — el body HTTP
   * sigue siendo SIEMPRE `EquipmentResponse[]`, con o sin paginación
   * (contract §6.1/§10): nunca se envuelve en `{ items, nextCursor }`.
   * Sin `limit` NI `cursor` → modo legacy, delega en `list()` sin
   * ningún cambio de comportamiento. Con cualquiera de los dos → modo
   * paginado; el cursor de continuación viaja exclusivamente en el
   * header `X-Next-Cursor` (ausente = última página).
   */
  @Get()
  async list(
    @CurrentUser() user: AuthUser,
    @Query() query: EquipmentQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<EquipmentResponse[]> {
    if (query.limit !== undefined || query.cursor !== undefined) {
      const page = await this.equipmentService.listPaginated(user.userId, query);
      if (page.nextCursor !== null) {
        res.setHeader('X-Next-Cursor', page.nextCursor);
      }
      return page.items;
    }
    return this.equipmentService.list(user.userId, query);
  }

  @Get(':id')
  getById(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<EquipmentResponse> {
    return this.equipmentService.getById(user.userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEquipmentDto,
  ): Promise<EquipmentResponse> {
    return this.equipmentService.update(user.userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.equipmentService.archive(user.userId, id);
  }
}
