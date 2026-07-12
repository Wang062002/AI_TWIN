import fs from "node:fs";
import path from "node:path";

export function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
}

export function loadKnowledgeBase(person, root = "data/knowledge_bases") {
  const dir = path.resolve(root, person);
  return loadKnowledgeBaseFromDir(dir);
}

export function loadKnowledgeBaseFromDir(dirPath) {
  const dir = path.resolve(dirPath);
  return {
    dir,
    manifest: readJson(path.join(dir, "manifest.json")),
    profile: readJson(path.join(dir, "profile.json")),
    personaCard: readJson(path.join(dir, "persona_card.json")),
    safetyRules: readJson(path.join(dir, "safety_rules.json")),
    retrievalUnits: readJsonl(path.join(dir, "retrieval_units.jsonl")),
    styleExamples: readJsonl(path.join(dir, "style_examples.jsonl")),
    facts: readJsonl(path.join(dir, "memories", "facts.jsonl")),
    relations: readJsonl(path.join(dir, "memories", "relations.jsonl")),
    timeline: readJsonl(path.join(dir, "memories", "timeline.jsonl")),
    pending: readJsonl(path.join(dir, "memories", "pending_memory_candidates.jsonl"))
  };
}
