import type { DatabaseSync } from "node:sqlite";
import { allClusters, eventsForCluster } from "./db.ts";
import { topK } from "./similarity.ts";
import type { Llm } from "./types.ts";

const CONTEXT_CLUSTERS = 3;

export interface QueryResult {
  answer: string;
  sources: { title: string; score: number }[];
}

export async function queryMemory(db: DatabaseSync, llm: Llm, question: string): Promise<QueryResult> {
  const clusters = allClusters(db);
  if (clusters.length === 0) return { answer: "Memory is empty — ingest some notes first.", sources: [] };

  const hits = topK(await llm.embed(question), clusters, CONTEXT_CLUSTERS);

  // Summaries are lossy, so the raw notes behind each hit go in too.
  const context = hits
    .map(({ cluster }) => {
      const notes = eventsForCluster(db, cluster.id)
        .map((e) => `  - [${e.ts.slice(0, 10)}] ${e.raw_text}`)
        .join("\n");
      return `## ${cluster.title} (${cluster.primary_entity})\nSummary: ${cluster.summary}\nRaw notes:\n${notes}`;
    })
    .join("\n\n");

  const answer = await llm.answer({ question, context });
  return {
    answer,
    sources: hits.map(({ cluster, score }) => ({ title: cluster.title, score: Number(score.toFixed(3)) })),
  };
}
