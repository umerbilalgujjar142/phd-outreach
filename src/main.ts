import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 5000;
  await app.listen(port);
  Logger.log(`phd-outreach listening on http://localhost:${port}`, 'Bootstrap');
}
bootstrap();
