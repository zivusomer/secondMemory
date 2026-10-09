import type { DatabaseSync } from "node:sqlite";
import { openDb, allClusters, eventsForCluster } from "./db.ts";
import { createLlm } from "./llm.ts";
import { ingestEvent, type IngestInput } from "./ingest.ts";
import { queryMemory } from "./query.ts";
import type { Llm } from "./types.ts";

const USAGE = `Usage:
  npm start -- ingest "<note>" [--date YYYY-MM-DD]   add a note (--date backdates it)
  npm start -- ask "<question>"                      ask your memory
  npm start -- clusters                              list clusters and their notes
  npm start -- demo                                  run the Dan example end to end

Env: OPENAI_API_KEY (required except for "clusters"), DB_FILE (default memory_poc.db)`;

function parseArgs(argv: string[]): IngestInput {
  const dateIdx = argv.indexOf("--date");
  const date = dateIdx === -1 ? undefined : argv[dateIdx + 1];
  const rest = argv.filter((_, i) => dateIdx === -1 || (i !== dateIdx && i !== dateIdx + 1));
  if (dateIdx !== -1 && (!date || Number.isNaN(Date.parse(date)))) throw new Error(`Invalid --date: ${date}`);
  return { text: rest.join(" ").trim(), ts: date ? new Date(date).toISOString() : undefined };
}

function printClusters(db: DatabaseSync): void {
  const clusters = allClusters(db);
  if (!clusters.length) return console.log("(no clusters yet)");
  for (const c of clusters) {
    console.log(`\n# ${c.title}  [${c.primary_entity}] ${c.status}`);
    console.log(c.summary);
    for (const e of eventsForCluster(db, c.id)) console.log(`  - [${e.ts.slice(0, 10)}] ${e.raw_text}`);
  }
}

async function ingest(db: DatabaseSync, llm: Llm, input: IngestInput): Promise<void> {
  const r = await ingestEvent(db, llm, input);
  console.log(`[${r.action === "FUSE" ? "FUSED into" : "CREATED"}] ${r.title}`);
}

async function ask(db: DatabaseSync, llm: Llm, question: string): Promise<void> {
  const { answer, sources } = await queryMemory(db, llm, question);
  console.log(`\nQ: ${question}\nA: ${answer}\n`);
  console.log("Sources:", sources.map((s) => `${s.title} (${s.score})`).join("; "));
}

async function demo(db: DatabaseSync, llm: Llm): Promise<void> {
  const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString();
  await ingest(db, llm, {
    ts: daysAgo(14),
    text: "Had coffee with Dan. He told me his wife is pregnant, so they are looking for a bigger car.",
  });
  await ingest(db, llm, {
    ts: daysAgo(10),
    text: "Sarah recommended the book Project Hail Mary over lunch.",
  });
  await ingest(db, llm, {
    ts: daysAgo(0),
    text: "Met Dan for lunch. He visited a Mazda dealership today and test drove a 7-seater SUV.",
  });
  await ask(db, llm, "What kind of car is Dan looking for and why?");
}

const [cmd, ...args] = process.argv.slice(2);

type Command = (db: DatabaseSync, llm: Llm) => void | Promise<void>;
const commands: Record<string, Command> = {
  ingest(db, llm) {
    const input = parseArgs(args);
    if (!input.text) throw new Error("ingest needs a note");
    return ingest(db, llm, input);
  },
  ask(db, llm) {
    const { text } = parseArgs(args);
    if (!text) throw new Error("ask needs a question");
    return ask(db, llm, text);
  },
  clusters: (db) => printClusters(db),
  demo,
};

const run = cmd ? commands[cmd] : undefined;
if (!run) {
  console.log(USAGE);
  process.exit(cmd ? 1 : 0);
}
if (cmd !== "clusters" && !process.env.OPENAI_API_KEY) {
  console.error("OPENAI_API_KEY is not set.");
  process.exit(1);
}

const db = openDb(process.env.DB_FILE);
try {
  await run(db, cmd === "clusters" ? ({} as Llm) : createLlm());
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  db.close();
}
