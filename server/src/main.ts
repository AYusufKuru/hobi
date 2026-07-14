import { config } from 'dotenv';
config();

import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { getCorsOrigins } from './cors';

async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule);
    app.enableCors({
      origin: getCorsOrigins(),
      credentials: true,
    });

    // Render / load-balancer health checks
    const http = app.getHttpAdapter().getInstance();
    http.get('/health', (_req: unknown, res: { status: (n: number) => { send: (s: string) => void } }) => {
      res.status(200).send('ok');
    });

    const port = Number(process.env.PORT ?? 3001);
    await app.listen(port, '0.0.0.0');
    const dbMode = process.env.DATABASE_URL
      ? 'postgres (DATABASE_URL)'
      : (process.env.DB_TYPE ?? 'sqlite');
    console.log(
      `GovOrbit server listening on 0.0.0.0:${port} · db=${dbMode}`,
    );
  } catch (err) {
    console.error('GovOrbit failed to start:', err);
    process.exit(1);
  }
}

bootstrap();
