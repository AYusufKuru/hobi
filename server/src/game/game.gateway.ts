import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { GameService } from './game.service';
import { PlayerInput } from './game.types';

@WebSocketGateway({
  cors: {
    origin: ['http://localhost:5173', 'http://127.0.0.1:5173'],
    credentials: true,
  },
})
export class GameGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private broadcastHandle: NodeJS.Timeout | null = null;

  constructor(private readonly game: GameService) {}

  afterInit() {
    this.broadcastHandle = setInterval(() => {
      const events = this.game.drainEvents();
      for (const event of events) {
        if (event.type === 'hit') {
          this.server.emit('hit', event);
        } else if (event.type === 'killed') {
          this.server.emit('killed', event);
        } else if (event.type === 'youDied') {
          this.server.emit('youDied', {
            respawnInMs: 2500,
            victimId: event.victimId,
          });
        } else if (event.type === 'credits') {
          this.server.emit('credits', event);
        } else if (event.type === 'loot') {
          this.server.emit('loot', event);
        } else if (event.type === 'portal') {
          this.server.emit('portal', event);
        } else if (event.type === 'portalChannel') {
          this.server.emit('portalChannel', event);
        } else if (event.type === 'portalCancel') {
          this.server.emit('portalCancel', event);
        }
      }
      this.server.emit('snapshot', this.game.getSnapshot());
    }, 33);
  }

  handleConnection(client: Socket) {
    client.emit('snapshot', this.game.getSnapshot());
  }

  handleDisconnect(client: Socket) {
    const playerId = this.game.leave(client.id);
    if (playerId) {
      this.server.emit('playerLeft', { id: playerId });
    }
  }

  @SubscribeMessage('auth:register')
  async handleRegister(
    @MessageBody()
    body: { email?: string; name?: string; password?: string },
  ) {
    return this.game.register(
      body?.email ?? '',
      body?.name ?? '',
      body?.password ?? '',
    );
  }

  @SubscribeMessage('join')
  async handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { name?: string; password?: string },
  ) {
    const result = await this.game.join(
      client.id,
      body?.name ?? '',
      body?.password ?? '',
    );
    if (result.ok) {
      client.broadcast.emit('playerJoined', result.self);
    }
    return result;
  }

  @SubscribeMessage('input')
  handleInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: PlayerInput,
  ) {
    this.game.setInput(client.id, body);
  }

  @SubscribeMessage('portal:jump')
  handlePortalJump(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { portalId?: string },
  ) {
    return this.game.startPortalJump(client.id, body?.portalId ?? '');
  }

  @SubscribeMessage('hangar:get')
  handleHangarGet(@ConnectedSocket() client: Socket) {
    return this.game.getHangarState(client.id);
  }

  @SubscribeMessage('hangar:buy')
  handleHangarBuy(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { itemId?: string },
  ) {
    return this.game.buyItem(client.id, body?.itemId ?? '');
  }

  @SubscribeMessage('hangar:activateShip')
  handleActivateShip(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { shipId?: string },
  ) {
    return this.game.activateShip(client.id, body?.shipId ?? '');
  }

  @SubscribeMessage('hangar:equipSlot')
  handleEquipSlot(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      shipId?: string;
      slotKind?: 'laser' | 'generator';
      slotIndex?: number;
      itemId?: string;
    },
  ) {
    return this.game.equipSlot(client.id, body ?? {});
  }

  @SubscribeMessage('hangar:unequipSlot')
  handleUnequipSlot(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      shipId?: string;
      slotKind?: 'laser' | 'generator';
      slotIndex?: number;
    },
  ) {
    return this.game.unequipSlot(client.id, body ?? {});
  }
}
