import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { generateGuardedReply } from "../src/generation.js";
import { loadKnowledgeBaseFromDir } from "../src/kb.js";
import { loadPersonConfig } from "../src/person_config.js";
import { buildMessages } from "../src/prompt.js";
import { retrieveContext } from "../src/retriever.js";
import { assessResponse } from "../src/response_guard.js";

const DEFAULT_TEMPLATES = [
  "eval/templates/balanced_daily.json",
  "eval/templates/stress_boundary.json"
];

const RELATIONSHIP_TEMPLATES = {
  friend: [
    "eval/templates/friend_daily.json",
    "eval/templates/friend_boundary.json"
  ]
};

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

function basicMetrics(input, reply, retrieved) {
  const text = String(reply || "");
  const assessment = assessResponse({ input, reply: text, retrieved });
  return {
    chars: [...text].length,
    lines: text.split(/\r?\n/).filter((line) => line.trim()).length,
    has_question: /[?\uFF1F\u5417\u5462\u600e\u4e48]/.test(text),
    says_unclear: /\u4e0d\u8bb0\u5f97|\u4e0d\u592a\u8bb0\u5f97|\u6a21\u7cca|\u4e0d\u6e05\u695a|\u4e0d\u786e\u5b9a/.test(text),
    possible_guess: /\u662f\u4e0d\u662f|\u5e94\u8be5\u662f|\u53ef\u80fd\u662f|\u8ddf\u540c\u5b66|\u90a3\u5bb6/.test(text),
    long_reply: [...text].length > 80,
    therapist_tone: /\u60c5\u7eea|\u63a5\u7eb3|\u611f\u53d7|\u652f\u6301\u4f60|\u4f60\u53ef\u4ee5\u5c1d\u8bd5|\u6df1\u547c\u5438/.test(text),
    boundary_risks: assessment.boundary_risks,
    copy_risks: assessment.copy_risks
  };
}

function compareSummaries(previous, current) {
  if (!previous) return ["No previous version found. This is the baseline report."];
  const lines = [];
  const prevMap = new Map(previous.results.map((item) => [item.case_key, item]));
  for (const item of current.results) {
    const prev = prevMap.get(item.case_key);
    if (!prev) {
      lines.push(`- ${item.case_key}: new case in this version.`);
      continue;
    }
    const diffs = [];
    if (prev.metrics.chars !== item.metrics.chars) diffs.push(`length ${prev.metrics.chars}->${item.metrics.chars}`);
    if (prev.metrics.says_unclear !== item.metrics.says_unclear) diffs.push(`unclear ${prev.metrics.says_unclear}->${item.metrics.says_unclear}`);
    if (prev.metrics.possible_guess !== item.metrics.possible_guess) diffs.push(`possible_guess ${prev.metrics.possible_guess}->${item.metrics.possible_guess}`);
    if (prev.metrics.therapist_tone !== item.metrics.therapist_tone) diffs.push(`therapist_tone ${prev.metrics.therapist_tone}->${item.metrics.therapist_tone}`);
    if (Boolean(prev.generation?.retried) !== Boolean(item.generation?.retried)) diffs.push(`retried ${Boolean(prev.generation?.retried)}->${Boolean(item.generation?.retried)}`);
    const previousRisks = (prev.metrics.boundary_risks || []).join(",") || "none";
    const currentRisks = (item.metrics.boundary_risks || []).join(",") || "none";
    if (previousRisks !== currentRisks) diffs.push(`boundary_risks ${previousRisks}->${currentRisks}`);
    const previousCopyRisks = (prev.metrics.copy_risks || []).length;
    const currentCopyRisks = (item.metrics.copy_risks || []).length;
    if (previousCopyRisks !== currentCopyRisks) diffs.push(`copy_risks ${previousCopyRisks}->${currentCopyRisks}`);
    if (prev.reply !== item.reply) diffs.push("reply changed");
    if (diffs.length) lines.push(`- ${item.case_key}: ${diffs.join("; ")}`);
  }
  return lines.length ? lines : ["No measurable differences from previous version."];
}

function pushManualRatingBlock(lines) {
  lines.push("**人工评分：**");
  lines.push("");
  lines.push("| 维度 | 分数/结果 | 备注 |");
  lines.push("| --- | --- | --- |");
  lines.push("| 相似度 1-5 |  |  |");
  lines.push("| 自然度 1-5 |  |  |");
  lines.push("| 情感合适度 1-5 |  |  |");
  lines.push("| 事实可靠性 1-5 |  |  |");
  lines.push("| AI 感 1-5 |  |  |");
  lines.push("| 是否需要调整 |  |  |");
  lines.push("");
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
  lines.push("## Test Results");
  lines.push("");

  const byTemplate = new Map();
  for (const item of summary.results) {
    if (!byTemplate.has(item.template_id)) byTemplate.set(item.template_id, []);
    byTemplate.get(item.template_id).push(item);
  }

  for (const template of summary.templates) {
    const items = byTemplate.get(template.id) || [];
    lines.push(`## ${template.name}`);
    lines.push("");
    lines.push(`> ${template.description}`);
    lines.push("");
    for (const item of items) {
      lines.push(`### ${item.scene} / ${item.id}`);
      lines.push("");
      lines.push(`**Focus:** ${item.focus}`);
      lines.push("");
      lines.push(`**用户输入：** ${item.input}`);
      lines.push("");
      lines.push("**模型回复：**");
      lines.push("");
      lines.push("```text");
      lines.push(item.reply);
      lines.push("```");
      lines.push("");
      pushManualRatingBlock(lines);
      lines.push(`**Quick Metrics:** chars=${item.metrics.chars}, lines=${item.metrics.lines}, says_unclear=${item.metrics.says_unclear}, possible_guess=${item.metrics.possible_guess}, therapist_tone=${item.metrics.therapist_tone}, retried=${item.generation.retried}, boundary_risks=${item.metrics.boundary_risks.join(",") || "none"}, copy_risks=${item.metrics.copy_risks.length}`);
      lines.push("");
      if (item.generation.retried) {
        lines.push("<details>");
        lines.push("<summary>Guard retry details</summary>");
        lines.push("");
        lines.push("Initial reply:");
        lines.push("");
        lines.push("```text");
        lines.push(item.generation.initial_reply);
        lines.push("```");
        lines.push("");
        lines.push(`Initial risks: boundary_risks=${item.generation.initial_boundary_risks.join(",") || "none"}, copy_risks=${item.generation.initial_copy_risks}`);
        lines.push("");
        lines.push("</details>");
        lines.push("");
      }
      lines.push("<details>");
      lines.push("<summary>检索参考与风格样本</summary>");
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
      lines.push("</details>");
      lines.push("");
    }
  }

  lines.push("## Raw Case Details");
  lines.push("");
  lines.push("The section below keeps stable case keys for version comparison.");
  lines.push("");
  for (const item of summary.results) {
    lines.push(`### ${item.case_key}`);
    lines.push("");
    lines.push(`- Strategy: ${item.template_name}`);
    lines.push(`- Scene: ${item.scene}`);
    lines.push(`- Focus: ${item.focus}`);
    lines.push(`- Input: ${item.input}`);
    lines.push(`- Metrics: chars=${item.metrics.chars}, lines=${item.metrics.lines}, says_unclear=${item.metrics.says_unclear}, possible_guess=${item.metrics.possible_guess}, therapist_tone=${item.metrics.therapist_tone}, retried=${item.generation.retried}, boundary_risks=${item.metrics.boundary_risks.join(",") || "none"}, copy_risks=${item.metrics.copy_risks.length}`);
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
  if (!args.person) {
    throw new Error("Missing --person. Example: npm run eval -- --person mom");
  }
  const person = String(args.person).trim();
  const resultsDir = path.resolve(args.output || path.join("eval/results", person));
  const config = loadConfig();
  const personConfig = loadPersonConfig(person, { config: args.config });
  const templateFiles = args.template
    ? [args.template]
    : RELATIONSHIP_TEMPLATES[personConfig.relationship_to_user] || DEFAULT_TEMPLATES;
  const templates = templateFiles.map((file) => readJson(path.resolve(file)));
  const kb = loadKnowledgeBaseFromDir(personConfig.knowledge_base_output);
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
    manual_rating_schema: ["similarity_1_5", "naturalness_1_5", "emotional_fit_1_5", "factual_reliability_1_5", "ai_feel_1_5", "needs_adjustment"],
    results: []
  };

  for (const template of templates) {
    console.log(`Template: ${template.name}`);
    for (const test of template.cases) {
      const retrieved = retrieveContext(kb, test.input, config.retrieval);
      const messages = buildMessages(kb, test.input, retrieved);
      const caseKey = `${template.id}/${test.id}`;
      console.log(`- ${caseKey}`);
      const generation = await generateGuardedReply(config.provider, messages, {
        input: test.input,
        retrieved,
        maxRetries: 1
      });
      const reply = generation.reply;
      const firstAttempt = generation.attempts[0];
      summary.results.push({
        case_key: caseKey,
        template_id: template.id,
        template_name: template.name,
        id: test.id,
        scene: test.scene,
        focus: test.focus,
        input: test.input,
        reply,
        generation: {
          retried: generation.retried,
          retry_count: generation.retry_count,
          initial_reply: firstAttempt.reply,
          initial_boundary_risks: firstAttempt.assessment.boundary_risks,
          initial_copy_risks: firstAttempt.assessment.copy_risks.length,
          final_boundary_risks: generation.assessment.boundary_risks,
          final_copy_risks: generation.assessment.copy_risks.length
        },
        metrics: basicMetrics(test.input, reply, retrieved),
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
