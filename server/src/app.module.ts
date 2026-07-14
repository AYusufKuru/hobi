import { config } from 'dotenv';
config();

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { GameModule } from './game/game.module';
import { PlayerEntity } from './player/player.entity';

/**
 * Prefer persistent Postgres in production.
 * - DATABASE_URL (Neon / Supabase / Render / Railway)
 * - or DB_TYPE=postgres + DB_HOST/...
 * Local demo still defaults to SQLite.
 */
function buildTypeOrmConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    // Managed Postgres (Neon etc.) — allow cloud certs by default
    return {
      type: 'postgres' as const,
      url: databaseUrl,
      ssl:
        process.env.DB_SSL === 'false'
          ? false
          : {
              rejectUnauthorized:
                process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
            },
      entities: [PlayerEntity],
      synchronize: true,
      retryAttempts: 5,
      retryDelay: 3000,
    };
  }

  const dbType = (process.env.DB_TYPE ?? 'sqlite').toLowerCase();

  if (dbType === 'postgres') {
    return {
      type: 'postgres' as const,
      host: process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.DB_PORT ?? 5432),
      username: process.env.DB_USER ?? 'govorbit',
      password: process.env.DB_PASSWORD ?? 'govorbit',
      database: process.env.DB_NAME ?? 'govorbit',
      ssl:
        process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
          : false,
      entities: [PlayerEntity],
      synchronize: true,
    };
  }

  const dataDir = join(__dirname, '..', 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  return {
    type: 'better-sqlite3' as const,
    database: join(dataDir, 'govorbit.sqlite'),
    entities: [PlayerEntity],
    synchronize: true,
  };
}

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildTypeOrmConfig(),
    }),
    GameModule,
  ],
})
export class AppModule {}
