import { test } from "node:test";
import assert from "node:assert/strict";
import { openDb, allClusters, eventsForCluster } from "../src/db.ts";
import { ingestEvent } from "../src/ingest.ts";
import { queryMemory } from "../src/query.ts";
import type { Llm } from "../src/types.ts";

// Deterministic stand-in for the LLM: bag-of-words embeddings, and a fusion
// rule that joins the best candidate when it shares enough vocabulary.
const VOCAB = ["dan", "car", "pregnant", "suv", "mazda", "book", "sarah", "hail", "mary"];
const embed = async (text: string) => {
  const t = text.toLowerCase();
  return VOCAB.map((w) => (t.includes(w) ? 1 : 0));
};

function fakeLlm({ fuseOverrideId }: { fuseOverrideId?: string } = {}): Llm {
  return {
    embed,
    async decideCluster({ text, candidates }) {
      const best = candidates[0];
      const fuse = fuseOverrideId ?? (best && best.similarity > 0.4 ? best.id : null);
      return {
        action: fuse ? "FUSE" : "CREATE",
        target_cluster_id: fuse,
        cluster_title: best && fuse === best.id ? best.title : `Topic: ${text.slice(0, 20)}`,
        primary_entity: "Dan",
        updated_summary: [best && fuse ? best.summary : null, text].filter(Boolean).join(" | "),
      };
    },
    answer: async ({ context }) => context,
  };
}

test("related notes fuse into one cluster, unrelated ones get their own", async () => {
  const db = openDb(":memory:");
  const llm = fakeLlm();

  const a = await ingestEvent(db, llm, { text: "Dan: wife is pregnant, needs a bigger car", ts: "2026-09-25T10:00:00Z" });
  const b = await ingestEvent(db, llm, { text: "Sarah recommended the book Project Hail Mary", ts: "2026-09-29T10:00:00Z" });
  const c = await ingestEvent(db, llm, { text: "Dan test drove an SUV at the Mazda dealership, car search", ts: "2026-10-09T10:00:00Z" });

  assert.equal(a.action, "CREATE");
  assert.equal(b.action, "CREATE");
  assert.equal(c.action, "FUSE");
  assert.equal(c.clusterId, a.clusterId);
  assert.equal(allClusters(db).length, 2);

  // Raw notes stay linked to their cluster, in time order.
  const notes = eventsForCluster(db, a.clusterId);
  assert.deepEqual(notes.map((n) => n.ts.slice(0, 10)), ["2026-09-25", "2026-10-09"]);
});

test("a FUSE pointing at a cluster that was not offered becomes a CREATE", async () => {
  const db = openDb(":memory:");
  await ingestEvent(db, fakeLlm(), { text: "Dan car pregnant" });
  const r = await ingestEvent(db, fakeLlm({ fuseOverrideId: "made-up-id" }), { text: "Dan SUV" });
  assert.equal(r.action, "CREATE");
  assert.equal(allClusters(db).length, 2);
});

test("query retrieves the matching cluster with its raw notes", async () => {
  const db = openDb(":memory:");
  const llm = fakeLlm();
  await ingestEvent(db, llm, { text: "Dan: wife is pregnant, needs a bigger car", ts: "2026-09-25T10:00:00Z" });
  await ingestEvent(db, llm, { text: "Sarah recommended the book Project Hail Mary", ts: "2026-09-29T10:00:00Z" });

  const { answer, sources } = await queryMemory(db, llm, "which car does Dan want?");
  assert.match(sources[0]!.title, /Dan/);
  assert.match(answer, /\[2026-09-25\] Dan: wife is pregnant/);
});

test("querying an empty memory does not call the LLM", async () => {
  const db = openDb(":memory:");
  const { sources } = await queryMemory(db, {} as Llm, "anything?");
  assert.deepEqual(sources, []);
});
