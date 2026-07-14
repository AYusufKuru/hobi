import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { SpaceScene, type SceneHud } from './SpaceScene';
import type { GameSocket } from './socket';
import type { Snapshot, WorldConfig } from './types';

type Props = {
  socket: GameSocket;
  selfId: string;
  world: WorldConfig;
  snapshot?: Snapshot;
  hud: SceneHud;
};

export default function PhaserGame({
  socket,
  selfId,
  world,
  snapshot,
  hud,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (!hostRef.current || gameRef.current) return;

    const host = hostRef.current;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: host.clientWidth || window.innerWidth,
      height: host.clientHeight || window.innerHeight,
      backgroundColor: '#05070f',
      physics: {
        default: 'arcade',
        arcade: { debug: false },
      },
      scene: [SpaceScene],
      scale: {
        mode: Phaser.Scale.RESIZE,
        parent: host,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: host.clientWidth || window.innerWidth,
        height: host.clientHeight || window.innerHeight,
      },
    });

    game.scene.start('SpaceScene', {
      socket,
      selfId,
      world,
      snapshot,
      hud,
    });

    gameRef.current = game;

    return () => {
      game.destroy(true);
      gameRef.current = null;
    };
    // Mount once per session join
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div className="phaser-host" ref={hostRef} />;
}
