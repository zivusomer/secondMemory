import { DatabaseSync } from "node:sqlite";
import type { Cluster, RawEvent } from "./types.ts";

export function openDb(file = "memory_poc.db"): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS clusters (
      id             TEXT PRIMARY KEY,
      title          TEXT NOT NULL,
      primary_entity TEXT NOT NULL,
      summary        TEXT NOT NULL,
      embedding      BLOB NOT NULL,
      status         TEXT NOT NULL DEFAULT 'active',
      created_at     TEXT NOT NULL,
      updated_at     TEXT NOT NULL
    );

    -- Immutable audit log: raw notes are never rewritten, only linked to a cluster.
    CREATE TABLE IF NOT EXISTS raw_events (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      ts         TEXT NOT NULL,
      raw_text   TEXT NOT NULL,
      cluster_id TEXT REFERENCES clusters(id)
    );
    CREATE INDEX IF NOT EXISTS idx_events_cluster ON raw_events(cluster_id);
  `);
  return db;
}

export const toBlob = (vec: number[]): Uint8Array => new Uint8Array(new Float32Array(vec).buffer);

export const fromBlob = (blob: Uint8Array): number[] =>
  Array.from(new Float32Array(blob.buffer, blob.byteOffset, blob.byteLength / 4));

type ClusterRow = Omit<Cluster, "embedding"> & { embedding: Uint8Array };

export function allClusters(db: DatabaseSync): Cluster[] {
  const rows = db.prepare("SELECT * FROM clusters ORDER BY updated_at DESC").all() as unknown as ClusterRow[];
  return rows.map((c) => ({ ...c, embedding: fromBlob(c.embedding) }));
}

export function eventsForCluster(db: DatabaseSync, clusterId: string): RawEvent[] {
  return db
    .prepare("SELECT id, ts, raw_text FROM raw_events WHERE cluster_id = ? ORDER BY ts")
    .all(clusterId) as unknown as RawEvent[];
}
