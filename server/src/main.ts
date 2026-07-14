import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`GovOrbit server listening on http://localhost:${port}`);
}

bootstrap();
