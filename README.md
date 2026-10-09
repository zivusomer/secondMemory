# second-memory

A personal episodic memory app. You write short notes about what happened (conversations, places, things people told you); the app groups related notes into living topics and lets you ask questions about them later.

This is a minimal end-to-end PoC in TypeScript: manual text input, local SQLite, OpenAI for embeddings and reasoning. The goal is to test one risky idea: **can an LLM reliably decide which topic a new note belongs to?**

## Definitions

| Term | Meaning |
| --- | --- |
| **Note / raw event** | One thing you typed, with a timestamp. Stored as-is and never edited. This is the audit log. |
| **Cluster** | One ongoing topic, e.g. "Dan's family car search". It is the app's unit of memory. A cluster has a title, a primary entity, an LLM-maintained summary, an embedding, and the raw notes linked to it. |
| **Primary entity** | The main person, place or thing a cluster is about (e.g. Dan). |
| **Summary** | A running, dated narrative of the cluster, rewritten by the LLM every time a note joins it. Lossy by design; the raw notes are the source of truth. |
| **Embedding** | A vector that represents the *meaning* of a text. Texts with similar meaning have vectors that point in similar directions, so "7-seater SUV" lands near "bigger car". |
| **Cosine similarity** | The score (-1 to 1) used to compare two embeddings. Higher means closer in meaning. |
| **Candidate** | One of the top 3 existing clusters most similar to a new note. Only candidates are shown to the LLM. |
| **Fusion** | The decision made for each new note: **FUSE** it into a candidate cluster (the note continues that topic and the summary is rewritten), or **CREATE** a new cluster. |
| **Retrieval (RAG)** | Answering a question by first finding the most relevant clusters, then giving them (plus their raw notes) to the LLM as the only source for its answer. |

## How it works

```
 ingest "note"                                      ask "question"
      │                                                   │
      ▼                                                   ▼
 save raw note (audit log)                      embed the question
      │                                                   │
      ▼                                                   ▼
 embed the note                                 top 3 clusters by similarity
      │                                                   │
      ▼                                                   ▼
 top 3 similar clusters = candidates            pull each cluster's raw notes
      │                                                   │
      ▼                                                   ▼
 LLM decides  ┌─ FUSE   → update that cluster     LLM answers using only that
              └─ CREATE → new cluster             memory (or says it's missing)
      │
      ▼
 link the note to its cluster
```

Example: "Dan's wife is pregnant, they need a bigger car" creates a cluster. Two weeks later "Dan test drove a 7-seater" is embedded, lands near that cluster, the LLM sees they are the same topic and fuses it. Asking "what car is Dan looking for and why?" then returns the whole story.

## Design decisions

- **Clusters over a flat timeline.** The question is almost always "what do I know about X", not "what happened on day Y". Grouping at write time makes that a single lookup.
- **Raw notes are immutable.** Summaries are lossy and the LLM can be wrong. Keeping the originals means a bad merge can be audited or re-run, and answers include the raw notes as well as the summary.
- **Similarity narrows, the LLM decides.** Embeddings cheaply pick 3 candidates; the LLM makes the actual fuse/create call, since "same person" does not mean "same topic". The prompt tells it that sharing a person or place is not enough to fuse.
- **The model's choice is validated.** A FUSE pointing at a cluster that was not one of the offered candidates is treated as CREATE.
- **Dates are anchored in summaries.** Each note's date is passed to the LLM so summaries read "on 2026-09-25 ...; on 2026-10-09 ...". `--date` lets you backdate notes for testing.
- **Raw note is saved first.** If an LLM call fails, the note is still in the audit log; the cluster write and the note-to-cluster link happen in one transaction.
- **TypeScript, no build step.** Node 22.18+ runs `.ts` files directly by stripping the types, so there is nothing to compile. `tsc` is used only to type-check (`npm run typecheck`), which is why the code sticks to erasable syntax (`import type`, no enums) and imports use the `.ts` extension.
- **SQLite via `node:sqlite`.** One local file, no native dependencies. Embeddings are stored as float32 blobs and compared in JS, which is fine at PoC scale (a full scan per note).
- **Deliberately not built yet:** mobile app, location triggers, app connectors (WhatsApp, Gmail), evening recap, graph database, voice input. The original design discussion covers these; the relational tables here are the first step before a graph.

## Layout

```
src/index.ts       CLI (ingest, ask, clusters, demo)
src/ingest.ts      save note, find candidates, fuse or create
src/query.ts       retrieval and answering
src/llm.ts         OpenAI calls: embeddings, fusion decision, answer
src/db.ts          SQLite schema and helpers
src/similarity.ts  cosine similarity and top-k
src/types.ts       shared types, including the Llm interface the pipeline depends on
test/              pipeline tests with a fake Llm (no API key needed)
```

## Usage

Requires Node 22.18+ and an OpenAI API key.

```sh
npm install
echo 'OPENAI_API_KEY=your-key-here' > .env   # git-ignored; every clone needs its own

npm start -- ingest "Had coffee with Dan. His wife is pregnant, they need a bigger car." --date 2026-09-25
npm start -- ingest "Dan test drove a 7-seater at a Mazda dealership."
npm start -- ask "What car is Dan looking for and why?"
npm start -- clusters      # list clusters and their notes
npm start -- demo          # the Dan example end to end
npm test                   # offline tests, no API key
npm run typecheck          # tsc, no emit
```

`npm start` and `npm run dev` load `.env` automatically. `.env` is never committed, so each person who clones the repo creates their own with their own key.

Environment: `OPENAI_API_KEY` (required, except for `clusters`), `DB_FILE` (default `memory_poc.db`), `CHAT_MODEL` (default `gpt-4o-mini`), `EMBED_MODEL` (default `text-embedding-3-small`).

## Privacy

- Notes and questions are sent to OpenAI for embeddings and answers. Use an API key you are comfortable with.
- The database is a local file and is git-ignored (`*.db`), as are `.env` files. Do not commit real notes.

## What to validate with real use (3-5 days)

- **Cluster accuracy:** does a new note merge with the right older topic?
- **Over-clustering:** are unrelated events about the same person kept apart?
- **Friction:** is writing a quick note easy enough that you keep doing it?
