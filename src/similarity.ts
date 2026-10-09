import type { Cluster } from "./types.ts";

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export interface Scored {
  cluster: Cluster;
  score: number;
}

export function topK(queryVec: number[], clusters: Cluster[], k: number): Scored[] {
  return clusters
    .map((cluster) => ({ cluster, score: cosine(queryVec, cluster.embedding) }))
    .sort((x, y) => y.score - x.score)
    .slice(0, k);
}
