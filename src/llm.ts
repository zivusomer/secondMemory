import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { z } from "zod";
import type { Llm } from "./types.ts";

const CHAT_MODEL = process.env.CHAT_MODEL ?? "gpt-4o-mini";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "text-embedding-3-small";

const DecisionSchema = z.object({
  action: z.enum(["FUSE", "CREATE"]),
  target_cluster_id: z.string().nullable(),
  cluster_title: z.string(),
  primary_entity: z.string(),
  updated_summary: z.string(),
});

const FUSION_PROMPT = `You are a personal episodic-memory engine. You receive a new note the user wrote about something that happened, plus the most similar existing topic clusters.

A cluster is a living topic that groups related events over time (e.g. "Dan's family car search"). Decide whether the note continues one of the candidate clusters.

- If it clearly continues a candidate: action = "FUSE", target_cluster_id = that candidate's id, keep or refine its title, and rewrite updated_summary so it includes the new information.
- Otherwise: action = "CREATE", target_cluster_id = null, and write a new title and summary.

Rules:
- Sharing a person or place is NOT enough to fuse. The notes must be about the same ongoing topic, e.g. the same plan, problem, project or thread of conversation. Unrelated topics involving the same person get separate clusters.
- primary_entity is the main person, place or thing the topic is about.
- Preserve every concrete fact (names, titles, numbers, dates). Never invent facts.
- In updated_summary, anchor events with their dates (given with each note) so the timeline can be reconstructed, e.g. "On 2026-09-25 ...; on 2026-10-09 ...".`;

const ANSWER_PROMPT = `You answer questions about the user's own life using only the memory clusters and raw notes provided. If the memory does not contain the answer, say you don't have it recorded. Mention when things happened if the dates are available. Be concise.`;

export function createLlm(client: OpenAI = new OpenAI()): Llm {
  return {
    async embed(text) {
      const res = await client.embeddings.create({ model: EMBED_MODEL, input: text });
      return res.data[0]!.embedding;
    },

    async decideCluster({ text, ts, candidates }) {
      const completion = await client.chat.completions.parse({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: FUSION_PROMPT },
          {
            role: "user",
            content:
              `NEW NOTE (${ts.slice(0, 10)}):\n"${text}"\n\n` +
              `CANDIDATE CLUSTERS:\n${JSON.stringify(candidates, null, 2)}`,
          },
        ],
        response_format: zodResponseFormat(DecisionSchema, "cluster_decision"),
      });
      const decision = completion.choices[0]?.message.parsed;
      if (!decision) throw new Error("LLM returned no parsable cluster decision");
      return decision;
    },

    async answer({ question, context }) {
      const res = await client.chat.completions.create({
        model: CHAT_MODEL,
        messages: [
          { role: "system", content: ANSWER_PROMPT },
          { role: "user", content: `MEMORY:\n${context}\n\nQUESTION: ${question}` },
        ],
      });
      return (res.choices[0]?.message.content ?? "").trim();
    },
  };
}
