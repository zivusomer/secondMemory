import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { allClusters, toBlob } from "./db.ts";
import { topK } from "./similarity.ts";
import type { Candidate, Llm } from "./types.ts";

const CANDIDATES = 3;

export interface IngestInput {
  text: string;
  ts?: string;
}

export interface IngestResult {
  action: "FUSE" | "CREATE";
  clusterId: string;
  title: string;
}

export async function ingestEvent(
  db: DatabaseSync,
  llm: Llm,
  { text, ts = new Date().toISOString() }: IngestInput,
): Promise<IngestResult> {
  // Audit log first: the raw note is kept even if the LLM steps below fail.
  const { lastInsertRowid: eventId } = db
    .prepare("INSERT INTO raw_events (ts, raw_text) VALUES (?, ?)")
    .run(ts, text);

  const noteVec = await llm.embed(text);
  const candidates: Candidate[] = topK(noteVec, allClusters(db), CANDIDATES).map(({ cluster, score }) => ({
    id: cluster.id,
    title: cluster.title,
    primary_entity: cluster.primary_entity,
    summary: cluster.summary,
    similarity: Number(score.toFixed(3)),
  }));

  const decision = await llm.decideCluster({ text, ts, candidates });

  // Never trust the model's id blindly: fusing into a cluster that wasn't offered becomes a create.
  const targetId = decision.action === "FUSE" ? decision.target_cluster_id : null;
  const fuseInto = targetId !== null && candidates.some((c) => c.id === targetId) ? targetId : null;
  const clusterId = fuseInto ?? randomUUID();
  const embedding = toBlob(await llm.embed(`${decision.cluster_title}\n${decision.updated_summary}`));

  db.exec("BEGIN");
  try {
    if (fuseInto) {
      db.prepare(
        `UPDATE clusters
         SET title = ?, primary_entity = ?, summary = ?, embedding = ?, updated_at = ?
         WHERE id = ?`,
      ).run(decision.cluster_title, decision.primary_entity, decision.updated_summary, embedding, ts, clusterId);
    } else {
      db.prepare(
        `INSERT INTO clusters (id, title, primary_entity, summary, embedding, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(clusterId, decision.cluster_title, decision.primary_entity, decision.updated_summary, embedding, ts, ts);
    }
    db.prepare("UPDATE raw_events SET cluster_id = ? WHERE id = ?").run(clusterId, eventId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }

  return { action: fuseInto ? "FUSE" : "CREATE", clusterId, title: decision.cluster_title };
}
