import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SequelizeModule } from '@nestjs/sequelize';

@Module({
  imports: [
    SequelizeModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        dialect: 'postgres',
        host: config.get<string>('PG_HOST', 'localhost'),
        port: config.get<number>('PG_PORT', 5432),
        username: config.get<string>('PG_USER', 'postgres'),
        password: config.get<string>('PG_PASSWORD'),
        database: config.get<string>('PG_DATABASE', 'phd_outreach'),
        autoLoadModels: true,
        // Dev convenience: auto-create tables from models, and `alter` so new
        // columns/indexes on models reconcile on boot. Swap to migrations
        // before production use.
        synchronize: config.get('NODE_ENV') !== 'production',
        sync:
          config.get('NODE_ENV') !== 'production' ? { alter: true } : undefined,
        logging: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
