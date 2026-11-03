import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createBookingSchema } from '../../../packages/registry/dist/index.js';

/**
 * Demo seed data. Inserted only when the database is empty, so real
 * demonstration bookings are never wiped by a server restart.
 */
const SEED_STAFF = ['Marcus Cole', 'Jordan Blake'];
const SEED_SERVICES = ['Classic Cut', 'Beard Trim'];

export interface StaffRow {
  id: number;
  name: string;
}

export interface ServiceRow {
  id: number;
  name: string;
  duration_minutes: number;
}

/** Open (creating parent dirs) and migrate the SQLite database. */
export function openDatabase(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  createBookingSchema(db);
  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db: DatabaseSync): void {
  const staffCount = (db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }).n;
  if (staffCount === 0) {
    const insert = db.prepare('INSERT INTO staff (name) VALUES (?)');
    for (const name of SEED_STAFF) insert.run(name);
  }
  const serviceCount = (db.prepare('SELECT COUNT(*) AS n FROM services').get() as { n: number }).n;
  if (serviceCount === 0) {
    const insert = db.prepare('INSERT INTO services (name, duration_minutes) VALUES (?, 30)');
    for (const name of SEED_SERVICES) insert.run(name);
  }
}

export function listStaff(db: DatabaseSync): StaffRow[] {
  return db.prepare('SELECT id, name FROM staff ORDER BY id ASC').all() as unknown as StaffRow[];
}

export function listServices(db: DatabaseSync): ServiceRow[] {
  return db
    .prepare('SELECT id, name, duration_minutes FROM services ORDER BY id ASC')
    .all() as unknown as ServiceRow[];
}
