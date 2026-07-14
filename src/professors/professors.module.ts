import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { Professor } from './professor.model';
import { ProfessorsController } from './professors.controller';
import { ProfessorsService } from './professors.service';

@Module({
  imports: [SequelizeModule.forFeature([Professor])],
  controllers: [ProfessorsController],
  providers: [ProfessorsService],
  exports: [ProfessorsService],
})
export class ProfessorsModule {}
