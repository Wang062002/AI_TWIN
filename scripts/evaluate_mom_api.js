import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { loadKnowledgeBase } from "../src/kb.js";
import { buildMessages } from "../src/prompt.js";
import { callChatCompletions } from "../src/provider.js";
import { retrieveContext } from "../src/retriever.js";

const DEFAULT_TEMPLATES = [
  "eval/templates/balanced_daily.json",
  "eval/templates/stress_boundary.json"
];

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function compact(text, max = 160) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? value.slice(0, max) + "..." : value;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function nextVersion(resultsDir) {
  fs.mkdirSync(resultsDir, { recursive: true });
  const versions = fs.readdirSync(resultsDir)
    .map((name) => /^V(\d+)$/.exec(name))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  return versions.length ? Math.max(...versions) + 1 : 1;
}

function loadPreviousSummary(resultsDir, version) {
  if (version <= 1) return null;
  const previous = path.join(resultsDir, `V${version - 1}`, "summary.json");
  if (!fs.existsSync(previous)) return null;
  return readJson(previous);
}

function basicMetrics(reply) {
  const text = String(reply || "");
  return {
    chars: [...text].length,
    lines: text.split(/\r?\n/).filter((line) => line.trim()).length,
    has_question: /[?？吗呢咋怎么]/.test(text),
    says_unclear: /不记得|不太记得|模糊|不清楚|不确定/.test(text),
    possible_guess: /是不是|应该是|可能是|跟同学|那家/.test(text),
    long_reply: [...text].length > 80,
    therapist_tone: /情绪|接纳|感受|支持你|你可以尝试|深呼吸/.test(text)
  };
}

function compareSummaries(previous, current) {
  if (!previous) {
    return ["No previous version found. This is the baseline report."];
  }
  const lines = [];
  const prevMap = new Map(previous.results.map((item) => [item.case_key, item]));
  for (const item of current.results) {
    const prev = prevMap.get(item.case_key);
    if (!prev) {
      lines.push(`- ${item.case_key}: new case in this version.`);
      continue;
    }
    const diffs = [];
    if (prev.metrics.chars !== item.metrics.chars) {
      diffs.push(`length ${prev.metrics.chars}->${item.metrics.chars}`);
    }
    if (prev.metrics.says_unclear !== item.metrics.says_unclear) {
      diffs.push(`unclear ${prev.metrics.says_unclear}->${item.metrics.says_unclear}`);
    }
    if (prev.metrics.possible_guess !== item.metrics.possible_guess) {
      diffs.push(`possible_guess ${prev.metrics.possible_guess}->${item.metrics.possible_guess}`);
    }
    if (prev.metrics.therapist_tone !== item.metrics.therapist_tone) {
      diffs.push(`therapist_tone ${prev.metrics.therapist_tone}->${item.metrics.therapist_tone}`);
    }
    if (prev.reply !== item.reply) {
      diffs.push("reply changed");
    }
    if (diffs.length) lines.push(`- ${item.case_key}: ${diffs.join("; ")}`);
  }
  if (!lines.length) return ["No measurable differences from previous version."];
  return lines;
}

function renderMarkdown(summary, comparisonLines) {
  const lines = [];
  lines.push(`# AI Twin Evaluation ${summary.version_label}`);
  lines.push("");
  lines.push(`- Created at: ${summary.created_at}`);
  lines.push(`- Person: ${summary.person}`);
  lines.push(`- Model: ${summary.model}`);
  lines.push(`- Base URL: ${summary.base_url}`);
  lines.push(`- Templates: ${summary.templates.map((t) => t.id).join(", ")}`);
  lines.push("");
  lines.push("## Persona Snapshot");
  lines.push("");
  lines.push(`- Display name: ${summary.persona.display_name}`);
  lines.push(`- Relationship: ${summary.persona.relationship_to_user}`);
  lines.push(`- Mean reply length: ${summary.persona.mean_reply_length}`);
  lines.push(`- Short reply ratio: ${summary.persona.short_reply_ratio}`);
  lines.push(`- Question ratio: ${summary.persona.question_ratio}`);
  lines.push("");
  lines.push("## Comparison With Previous Version");
  lines.push("");
  lines.push(...comparisonLines);
  lines.push("");
  lines.push("## Results");
  lines.push("");
  for (const item of summary.results) {
    lines.push(`### ${item.case_key}`);
    lines.push("");
    lines.push(`- Strategy: ${item.template_name}`);
    lines.push(`- Scene: ${item.scene}`);
    lines.push(`- Focus: ${item.focus}`);
    lines.push(`- Input: ${item.input}`);
    lines.push(`- Metrics: chars=${item.metrics.chars}, lines=${item.metrics.lines}, says_unclear=${item.metrics.says_unclear}, possible_guess=${item.metrics.possible_guess}, therapist_tone=${item.metrics.therapist_tone}`);
    lines.push("");
    lines.push("Retrieved memories:");
    for (const memory of item.retrieved_memories) {
      lines.push(`- ${memory.id} | ${memory.labels.join(",") || "none"} | ${memory.text}`);
    }
    lines.push("");
    lines.push("Style examples:");
    for (const style of item.style_examples) {
      lines.push(`- ${style.id} | User: ${style.user} | Target: ${style.reply}`);
    }
    lines.push("");
    lines.push("Reply:");
    lines.push("");
    lines.push("```text");
    lines.push(item.reply);
    lines.push("```");
    lines.push("");
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  const person = args.person || "mom";
  const resultsDir = path.resolve(args.output || "eval/results");
  const templateFiles = args.template ? [args.template] : DEFAULT_TEMPLATES;
  const templates = templateFiles.map((file) => readJson(path.resolve(file)));
  const config = loadConfig();
  const kb = loadKnowledgeBase(person);
  const version = nextVersion(resultsDir);
  const versionLabel = `V${version}`;
  const versionDir = path.join(resultsDir, versionLabel);
  fs.mkdirSync(versionDir, { recursive: true });

  console.log(`AI Twin evaluation ${versionLabel}`);
  console.log(`Person: ${person}`);
  console.log(`Model: ${config.provider.model}`);
  console.log("");

  const summary = {
    version,
    version_label: versionLabel,
    created_at: new Date().toISOString(),
    person,
    model: config.provider.model,
    base_url: config.provider.baseUrl,
    templates: templates.map((template) => ({
      id: template.id,
      name: template.name,
      description: template.description
    })),
    persona: {
      display_name: kb.profile.display_name,
      relationship_to_user: kb.profile.relationship_to_user,
      mean_reply_length: kb.profile.language_style?.mean_reply_length,
      short_reply_ratio: kb.profile.language_style?.short_reply_ratio,
      question_ratio: kb.profile.language_style?.question_ratio
    },
    results: []
  };

  for (const template of templates) {
    console.log(`Template: ${template.name}`);
    for (const test of template.cases) {
      const retrieved = retrieveContext(kb, test.input, config.retrieval);
      const messages = buildMessages(kb, test.input, retrieved);
      const caseKey = `${template.id}/${test.id}`;
      console.log(`- ${caseKey}`);
      const reply = await callChatCompletions(config.provider, messages);
      summary.results.push({
        case_key: caseKey,
        template_id: template.id,
        template_name: template.name,
        id: test.id,
        scene: test.scene,
        focus: test.focus,
        input: test.input,
        reply,
        metrics: basicMetrics(reply),
        retrieved_memories: retrieved.memories.slice(0, 3).map((memory) => ({
          id: memory.id,
          labels: memory.metadata?.labels || [],
          text: compact(memory.text, 180)
        })),
        style_examples: retrieved.styles.slice(0, 3).map((style) => ({
          id: style.id,
          user: compact(style.user, 90),
          reply: compact(style.target_reply, 90)
        }))
      });
    }
    console.log("");
  }

  const previous = loadPreviousSummary(resultsDir, version);
  const comparison = compareSummaries(previous, summary);
  fs.writeFileSync(path.join(versionDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");
  fs.writeFileSync(path.join(versionDir, "report.md"), renderMarkdown(summary, comparison), "utf8");

  console.log(`Report written: ${path.join(versionDir, "report.md")}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
