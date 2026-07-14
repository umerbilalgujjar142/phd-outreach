import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CreateProfessorDto } from './dto/create-professor.dto';
import { ProfessorStatus } from './professor-status.enum';
import { ProfessorsService } from './professors.service';

@Controller('professors')
export class ProfessorsController {
  constructor(private readonly professors: ProfessorsService) {}

  @Post()
  create(@Body() dto: CreateProfessorDto) {
    return this.professors.upsert(dto);
  }

  @Get()
  findAll(
    @Query('status') status?: ProfessorStatus,
    @Query('country') country?: string,
  ) {
    return this.professors.findAll({ status, country });
  }

  @Get('count')
  async count() {
    return { count: await this.professors.count() };
  }

  /** On-demand Excel snapshot (Section 8, Step 10). */
  @Get('export/xlsx')
  async export(@Res() res: Response) {
    const wb = await this.professors.exportToWorkbook();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="PhD_Professor_Tracker.xlsx"',
    );
    await wb.xlsx.write(res);
    res.end();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.professors.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() patch: Partial<CreateProfessorDto>) {
    return this.professors.update(id, patch);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.professors.remove(id);
    return { deleted: true };
  }
}
