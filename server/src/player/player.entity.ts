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

  @Column({ type: 'float', default: 0 })
  x: number;

  @Column({ type: 'float', default: 0 })
  y: number;

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
