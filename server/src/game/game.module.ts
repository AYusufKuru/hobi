import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlayerEntity } from '../player/player.entity';
import { GameGateway } from './game.gateway';
import { GameService } from './game.service';

@Module({
  imports: [TypeOrmModule.forFeature([PlayerEntity])],
  providers: [GameService, GameGateway],
})
export class GameModule {}
