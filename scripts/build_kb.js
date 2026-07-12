import fs from "node:fs";
import path from "node:path";
import { writeJson, writeJsonl } from "../src/kb.js";
import { loadPersonConfig, validateRelationship } from "../src/person_config.js";
import { classifyText, cleanText, increment, monthOf, percentile, topEntries } from "../src/text.js";

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

function isTextMessage(message) {
  return message.localType === 1 || String(message.type || "").toLowerCase() === "text" || String(message.type || "").includes("\u6587\u672c");
}

function parseMessages(raw, displayName) {
  const rows = [];
  const report = {
    raw_message_count: raw.messages?.length || 0,
    non_text_skipped: 0,
    empty_text_skipped: 0,
    text_kept: 0
  };

  for (const message of raw.messages || []) {
    if (!isTextMessage(message)) {
      report.non_text_skipped += 1;
      continue;
    }
    const content = cleanText(message.content);
    if (!content) {
      report.empty_text_skipped += 1;
      continue;
    }
    rows.push({
      id: message.localId,
      role: message.isSend === 1 ? "user" : "twin",
      speaker: message.isSend === 1 ? "user" : displayName,
      content,
      ts: Number(message.createTime || 0),
      time: message.formattedTime || "",
      source: "wechat"
    });
  }

  rows.sort((a, b) => a.ts - b.ts);
  report.text_kept = rows.length;
  return { messages: rows, report };
}

function splitConversations(messages, thresholdSeconds = 3600) {
  const conversations = [];
  let current = [];
  let previous = null;
  for (const message of messages) {
    if (previous && message.ts && previous.ts && message.ts - previous.ts > thresholdSeconds) {
      if (current.length) conversations.push(current);
      current = [];
    }
    current.push(message);
    previous = message;
  }
  if (current.length) conversations.push(current);
  return conversations;
}

function mergeSameRole(conversation) {
  const merged = [];
  for (const message of conversation) {
    const last = merged[merged.length - 1];
    if (last && last.role === message.role) {
      last.content += "\n" + message.content;
      last.time = message.time || last.time;
      last.ts = message.ts || last.ts;
      last.ids.push(message.id);
    } else {
      merged.push({ ...message, ids: [message.id] });
    }
  }
  return merged;
}

function qualityLevel(pair) {
  if (pair.twin.length <= 2) return "too_short";
  if (/^\d+(\.\d+)?$/.test(pair.twin.trim())) return "number_only";
  if (isAiLikeOrPlanningText(pair.twin)) return "ai_like_long";
  if (pair.twin.length <= 8) return "short_style";
  if (pair.user.length > 180 || pair.twin.length > 180) return "long";
  return "normal";
}

function isAiLikeOrPlanningText(text) {
  const markers = [
    "\u4e3a\u60a8\u8bbe\u8ba1",
    "\u4ee5\u4e0b\u662f",
    "\u6839\u636e\u60a8\u7684",
    "\u7ecf\u5178\u4e14\u5145\u5b9e\u7684\u884c\u7a0b",
    "\u8003\u8651\u5230\u60a8\u7684\u9884\u7b97",
    "DeepSeek",
    "ChatGPT"
  ];
  return text.length > 260 && markers.some((marker) => text.includes(marker));
}

function buildPairs(conversations) {
  const pairs = [];
  const seen = new Set();
  const duplicated = { count: 0 };
  for (let c = 0; c < conversations.length; c += 1) {
    const merged = mergeSameRole(conversations[c]);
    for (let i = 0; i < merged.length - 1; i += 1) {
      const user = merged[i];
      const twin = merged[i + 1];
      if (user.role !== "user" || twin.role !== "twin") continue;
      const key = `${user.content}\n---\n${twin.content}`;
      if (seen.has(key)) {
        duplicated.count += 1;
        continue;
      }
      seen.add(key);
      const labels = classifyText(`${user.content}\n${twin.content}`);
      const pair = {
        id: `pair_${String(pairs.length + 1).padStart(5, "0")}`,
        conversation_id: c,
        user: user.content,
        twin: twin.content,
        time: twin.time || user.time,
        month: monthOf(twin.ts || user.ts),
        labels,
        source_message_ids: [...user.ids, ...twin.ids]
      };
      pair.quality = qualityLevel(pair);
      pairs.push(pair);
    }
  }
  return { pairs, duplicate_pair_count: duplicated.count };
}

function buildProfile(raw, messages, pairs, person, displayName, relationship) {
  const twinMessages = messages.filter((m) => m.role === "twin");
  const lengths = twinMessages.map((m) => m.content.length);
  const openings = new Map();
  const endings = new Map();
  const categoryCounts = new Map();
  const qualityCounts = new Map();

  for (const message of twinMessages) {
    if (message.content.length >= 2) increment(openings, message.content.slice(0, 2));
    if (message.content.length >= 4) increment(openings, message.content.slice(0, 4));
    if (message.content.length >= 2) increment(endings, message.content.slice(-2));
    for (const label of classifyText(message.content)) increment(categoryCounts, label);
  }
  for (const pair of pairs) increment(qualityCounts, pair.quality);

  return {
    person_id: person,
    display_name: displayName,
    relationship_to_user: relationship,
    source: {
      type: "wechat_export",
      session_remark: raw.session?.remark || "",
      session_display_name: raw.session?.displayName || "",
      exported_at: raw.weflow?.exportedAt || null
    },
    corpus_stats: {
      total_text_messages: messages.length,
      twin_text_messages: twinMessages.length,
      dialogue_pairs: pairs.length,
      first_time: messages[0]?.time || null,
      last_time: messages[messages.length - 1]?.time || null
    },
    language_style: {
      mean_reply_length: Number((lengths.reduce((a, b) => a + b, 0) / Math.max(1, lengths.length)).toFixed(1)),
      median_reply_length: percentile(lengths, 0.5),
      p75_reply_length: percentile(lengths, 0.75),
      short_reply_ratio: Number((twinMessages.filter((m) => m.content.length <= 12).length / Math.max(1, twinMessages.length)).toFixed(3)),
      question_ratio: Number((twinMessages.filter((m) => /[?\uff1f\u5417\u5462\u600e\u4e48]/.test(m.content)).length / Math.max(1, twinMessages.length)).toFixed(3)),
      linebreak_ratio: Number((twinMessages.filter((m) => m.content.includes("\n")).length / Math.max(1, twinMessages.length)).toFixed(3)),
      top_openings: topEntries(openings, 20),
      top_endings: topEntries(endings, 20)
    },
    dominant_topics: topEntries(categoryCounts, 12),
    pair_quality: topEntries(qualityCounts, 10),
    generation_guidance: [
      "Reply in natural Chinese.",
      "Prefer short, direct, everyday chat messages.",
      "Follow the configured relationship identity; do not assume every target person is a mother.",
      "Answer the user's immediate concern first, then add one practical caring sentence if needed.",
      "Avoid therapist tone, customer-service tone, grand emotional writing, and long explanations.",
      "Use real chat examples as style references, but do not copy them mechanically.",
      "Do not invent facts that are not supported by retrieved memory."
    ]
  };
}

function buildPersonaCard(profile) {
  return {
    person_id: profile.person_id,
    display_name: profile.display_name,
    relationship_to_user: profile.relationship_to_user,
    style_summary: {
      reply_length: "short and direct",
      emotional_texture: "learned from this target person's real chat data",
      common_behavior: "use the target person's own repeated patterns instead of a fixed family-role template",
      avoid: ["therapist tone", "customer-service tone", "overly poetic writing", "unsupported facts"]
    },
    numeric_style_reference: profile.language_style,
    generation_guidance: profile.generation_guidance
  };
}

function buildStyleExamples(pairs, limit = 240) {
  return pairs
    .filter((pair) => {
      if (pair.twin.length < 4 || pair.twin.length > 80 || pair.user.length > 140) return false;
      if (["number_only", "ai_like_long", "long"].includes(pair.quality)) return false;
      if (pair.labels.includes("money") && pair.twin.length <= 8) return false;
      return true;
    })
    .slice(0, limit)
    .map((pair, index) => ({
      id: `style_${String(index + 1).padStart(4, "0")}`,
      source_pair_id: pair.id,
      user: pair.user,
      target_reply: pair.twin,
      labels: pair.labels,
      time: pair.time,
      use_for: ["few_shot", "style_reference"]
    }));
}

function buildRetrievalUnits(pairs, displayName) {
  return pairs
    .filter((pair) => !["ai_like_long", "long"].includes(pair.quality))
    .map((pair) => ({
    id: `kb_${pair.id}`,
    layer: "dialogue_pair",
    text: `User: ${pair.user}\n${displayName}: ${pair.twin}`,
    metadata: {
      source_pair_id: pair.id,
      conversation_id: pair.conversation_id,
      labels: pair.labels,
      quality: pair.quality,
      time: pair.time,
      month: pair.month,
      source: "wechat"
    }
  }));
}

function buildFactsAndRelations(pairs, profile) {
  const facts = [
    {
      id: "fact_communication_short_direct",
      type: "style_fact",
      content: "The target person's replies are usually short, direct, practical, and everyday.",
      confidence: 0.9,
      stats: profile.language_style
    },
    {
      id: "fact_identity_relationship",
      type: "identity_fact",
      content: `The digital twin represents a target person whose configured relationship to the user is: ${profile.relationship_to_user}. The generation strategy must adapt to this identity instead of using a fixed mother template.`,
      confidence: 0.85
    }
  ];
  const relations = [
    {
      id: "rel_daily_care",
      type: "relationship_pattern",
      content: "The relationship pattern must be inferred from this person's chat data. Frequent topics and style samples should drive the reply more than any hard-coded identity assumption.",
      confidence: 0.86
    },
    {
      id: "rel_practical_not_overly_sentimental",
      type: "relationship_pattern",
      content: "Care is usually expressed through practical problem solving rather than long sentimental replies.",
      confidence: 0.84
    }
  ];
  for (const topic of profile.dominant_topics.slice(0, 8)) {
    if (topic.key === "general") continue;
    facts.push({
      id: `fact_topic_${topic.key}`,
      type: "topic_fact",
      content: `Historical chats contain frequent ${topic.key} related content.`,
      confidence: 0.72,
      count: topic.count
    });
  }
  return { facts, relations };
}

function buildTimeline(pairs) {
  const months = new Map();
  for (const pair of pairs) {
    if (!months.has(pair.month)) months.set(pair.month, { month: pair.month, pair_count: 0, labels: new Map(), samples: [] });
    const item = months.get(pair.month);
    item.pair_count += 1;
    for (const label of pair.labels) increment(item.labels, label);
    if (item.samples.length < 3) item.samples.push({ source_pair_id: pair.id, user: pair.user, twin: pair.twin, time: pair.time });
  }
  return [...months.values()].map((item) => ({
    month: item.month,
    pair_count: item.pair_count,
    dominant_labels: topEntries(item.labels, 5),
    samples: item.samples
  }));
}

const SAFETY_RULES = [
  { id: "boundary_not_real_person", rule: "The twin is generated from memory and style references; it must not imply the real person has literally returned or is online." },
  { id: "no_major_decision_proxy", rule: "Do not make real-world promises, authorizations, or major decisions on behalf of the target person." },
  { id: "no_unsupported_fact", rule: "Do not invent unsupported dates, places, promises, relationship events, or facts the target person never expressed." },
  { id: "emotional_safety", rule: "If the user shows extreme grief, self-harm signals, or loss of control, stabilize emotion and encourage contacting trusted real people or professional support." },
  { id: "privacy_first", rule: "Treat chat records and twin memories as private local user assets. Uploading or syncing requires explicit user confirmation." }
];

function main() {
  const args = parseArgs(process.argv);
  if (!args.person) {
    throw new Error("Missing --person. Example: npm run build:kb -- --person mom");
  }
  const personConfig = loadPersonConfig(String(args.person).trim(), {
    config: args.config,
    person: args.person,
    displayName: args["display-name"],
    relationship: args.relationship,
    input: args.input,
    output: args.output
  });
  const person = personConfig.person_id;
  const displayName = personConfig.display_name;
  const relationship = personConfig.relationship_to_user;
  const relationshipWarning = validateRelationship(relationship);
  if (relationshipWarning) console.warn(`[relationship warning] ${relationshipWarning}`);
  const input = path.resolve(personConfig.raw_input);
  const output = path.resolve(personConfig.knowledge_base_output);
  if (!fs.existsSync(input)) throw new Error(`Cannot find input: ${input}`);

  const raw = JSON.parse(fs.readFileSync(input, "utf8"));
  const { messages, report: cleaningReport } = parseMessages(raw, displayName);
  const conversations = splitConversations(messages);
  const { pairs, duplicate_pair_count } = buildPairs(conversations);
  const profile = buildProfile(raw, messages, pairs, person, displayName, relationship);
  const personaCard = buildPersonaCard(profile);
  const styleExamples = buildStyleExamples(pairs);
  const retrievalUnits = buildRetrievalUnits(pairs, displayName);
  const { facts, relations } = buildFactsAndRelations(pairs, profile);
  const timeline = buildTimeline(pairs);
  const pending = pairs
    .filter((pair) => pair.labels.some((label) => ["work", "study", "health", "travel", "comfort"].includes(label)))
    .slice(0, 80)
    .map((pair, index) => ({
      id: `pending_${String(index + 1).padStart(4, "0")}`,
      status: "pending_user_confirm",
      candidate_memory: `Historical dialogue may contain a long-term ${pair.labels.join("/")} memory.`,
      source_pair_id: pair.id,
      evidence: { user: pair.user, twin: pair.twin, time: pair.time },
      suggested_actions: ["confirm", "edit", "delete"]
    }));

  fs.mkdirSync(output, { recursive: true });
  writeJson(path.join(output, "manifest.json"), {
    name: `${person}-knowledge-base`,
    person_id: person,
    display_name: displayName,
    built_at: new Date().toISOString(),
    source_file: path.relative(process.cwd(), input),
    files: {
      profile: "profile.json",
      persona_card: "persona_card.json",
      retrieval_units: "retrieval_units.jsonl",
      style_examples: "style_examples.jsonl",
      facts: "memories/facts.jsonl",
      relations: "memories/relations.jsonl",
      timeline: "memories/timeline.jsonl",
      pending_memory_candidates: "memories/pending_memory_candidates.jsonl",
      safety_rules: "safety_rules.json",
      cleaning_report: "cleaning_report.json",
      build_report: "build_report.json"
    }
  });
  writeJson(path.join(output, "profile.json"), profile);
  writeJson(path.join(output, "persona_card.json"), personaCard);
  writeJsonl(path.join(output, "retrieval_units.jsonl"), retrievalUnits);
  writeJsonl(path.join(output, "style_examples.jsonl"), styleExamples);
  writeJsonl(path.join(output, "memories", "facts.jsonl"), facts);
  writeJsonl(path.join(output, "memories", "relations.jsonl"), relations);
  writeJsonl(path.join(output, "memories", "timeline.jsonl"), timeline);
  writeJsonl(path.join(output, "memories", "pending_memory_candidates.jsonl"), pending);
  writeJson(path.join(output, "safety_rules.json"), SAFETY_RULES);
  writeJson(path.join(output, "cleaning_report.json"), {
    ...cleaningReport,
    conversation_count: conversations.length,
    duplicate_pair_count,
    quality_distribution: profile.pair_quality
  });
  const buildReport = {
    input: path.relative(process.cwd(), input),
    output_dir: path.relative(process.cwd(), output),
    raw_message_count: raw.messages?.length || 0,
    text_message_count: messages.length,
    conversation_count: conversations.length,
    dialogue_pair_count: pairs.length,
    retrieval_unit_count: retrievalUnits.length,
    style_example_count: styleExamples.length,
    fact_count: facts.length,
    relation_count: relations.length,
    timeline_month_count: timeline.length,
    pending_memory_candidate_count: pending.length
  };
  writeJson(path.join(output, "build_report.json"), buildReport);
  console.log(JSON.stringify(buildReport, null, 2));
}

main();
