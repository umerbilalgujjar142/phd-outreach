import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Country } from './country.model';
import { CountriesService } from './countries.service';

@Controller('countries')
export class CountriesController {
  constructor(private readonly countries: CountriesService) {}

  @Get()
  findAll(@Query('active') active?: string) {
    return this.countries.findAll(active === 'true');
  }

  /** Add a new target country to widen the search scope. */
  @Post()
  create(@Body() dto: Partial<Country>) {
    return this.countries.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() patch: Partial<Country>) {
    return this.countries.update(id, patch);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.countries.remove(id);
    return { deleted: true };
  }
}
