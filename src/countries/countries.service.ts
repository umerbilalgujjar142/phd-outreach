import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { COUNTRY_SEED } from './country-seed';
import { Country } from './country.model';

@Injectable()
export class CountriesService implements OnModuleInit {
  private readonly logger = new Logger(CountriesService.name);

  constructor(@InjectModel(Country) private readonly model: typeof Country) {}

  /** Seed the Section 6 starting set once, if the table is empty. */
  async onModuleInit() {
    const count = await this.model.count();
    if (count === 0) {
      await this.model.bulkCreate(COUNTRY_SEED as any);
      this.logger.log(`Seeded ${COUNTRY_SEED.length} target countries`);
    }
  }

  findAll(onlyActive = false): Promise<Country[]> {
    return this.model.findAll({
      where: onlyActive ? { active: true } : undefined,
      order: [
        ['tier', 'ASC'],
        ['name', 'ASC'],
      ],
    });
  }

  /** Names of active target countries — used to weight/scope discovery. */
  async activeNames(): Promise<string[]> {
    const rows = await this.model.findAll({ where: { active: true } });
    return rows.map((r) => r.name);
  }

  async create(dto: Partial<Country>): Promise<Country> {
    return this.model.create(dto as any);
  }

  async update(id: number, patch: Partial<Country>): Promise<Country> {
    const row = await this.model.findByPk(id);
    if (!row) throw new NotFoundException(`Country ${id} not found`);
    await row.update(patch);
    return row;
  }

  async remove(id: number): Promise<void> {
    const row = await this.model.findByPk(id);
    if (!row) throw new NotFoundException(`Country ${id} not found`);
    await row.destroy();
  }
}
