import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('players')
export class PlayerEntity {
  @PrimaryColumn()
  id: string;

  @Column({ unique: true })
  name: string;

  @Column({ unique: true, nullable: true, type: 'varchar' })
  email: string | null;

  /** salt:hex format (scrypt). Empty = legacy account without password. */
  @Column({ type: 'text', default: '' })
  passwordHash: string;

  @Column({ type: 'float', default: 0 })
  x: number;

  @Column({ type: 'float', default: 0 })
  y: number;

  /** Current map id (e.g. map-1) */
  @Column({ type: 'varchar', default: 'map-1' })
  mapId: string;

  @Column({ type: 'int', default: 100 })
  hp: number;

  @Column({ type: 'int', default: 500 })
  credits: number;

  /** Altın (gold) — premium hangar currency */
  @Column({ type: 'int', default: 25 })
  gold: number;

  @Column({ type: 'int', default: 0 })
  kills: number;

  /** JSON loadout: owned, ship, laser, generators, ammo */
  @Column({ type: 'text', default: '' })
  loadoutJson: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
