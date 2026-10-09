export interface Cluster {
  id: string;
  title: string;
  primary_entity: string;
  summary: string;
  embedding: number[];
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RawEvent {
  id: number;
  ts: string;
  raw_text: string;
}

/** What the LLM sees of an existing cluster (no embedding, plus the similarity score). */
export interface Candidate {
  id: string;
  title: string;
  primary_entity: string;
  summary: string;
  similarity: number;
}

export interface Decision {
  action: "FUSE" | "CREATE";
  target_cluster_id: string | null;
  cluster_title: string;
  primary_entity: string;
  updated_summary: string;
}

/** Everything the pipeline needs from a language model. Swappable, so tests can fake it. */
export interface Llm {
  embed(text: string): Promise<number[]>;
  decideCluster(input: { text: string; ts: string; candidates: Candidate[] }): Promise<Decision>;
  answer(input: { question: string; context: string }): Promise<string>;
}
