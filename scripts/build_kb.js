import fs from "node:fs";
import path from "node:path";
import { writeJson, writeJsonl } from "../src/kb.js";
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
  return message.localType === 1 || String(message.type || "").includes("文本");
}

function parseMessages(raw, displayName) {
  const rows = [];
  for (const message of raw.messages || []) {
    if (!isTextMessage(message)) continue;
    const content = cleanText(message.content);
    if (!content) continue;
    rows.push({
      id: message.localId,
      role: message.isSend === 1 ? "user" : "twin",
      speaker: message.isSend === 1 ? "用户" : displayName,
      content,
      ts: Number(message.createTime || 0),
      time: message.formattedTime || "",
      source: "wechat"
    });
  }
  return rows.sort((a, b) => a.ts - b.ts);
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

function buildPairs(conversations) {
  const pairs = [];
  const seen = new Set();
  for (let c = 0; c < conversations.length; c += 1) {
    const merged = mergeSameRole(conversations[c]);
    for (let i = 0; i < merged.length - 1; i += 1) {
      const user = merged[i];
      const twin = merged[i + 1];
      if (user.role !== "user" || twin.role !== "twin") continue;
      const key = `${user.content}\n---\n${twin.content}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const labels = classifyText(`${user.content}\n${twin.content}`);
      pairs.push({
        id: `pair_${String(pairs.length + 1).padStart(5, "0")}`,
        conversation_id: c,
        user: user.content,
        twin: twin.content,
        time: twin.time || user.time,
        month: monthOf(twin.ts || user.ts),
        labels,
        source_message_ids: [...user.ids, ...twin.ids]
      });
    }
  }
  return pairs;
}

function buildProfile(raw, messages, pairs, person, displayName) {
  const twinMessages = messages.filter((m) => m.role === "twin");
  const lengths = twinMessages.map((m) => m.content.length);
  const openings = new Map();
  const endings = new Map();
  const categoryCounts = new Map();
  for (const message of twinMessages) {
    if (message.content.length >= 2) increment(openings, message.content.slice(0, 2));
    if (message.content.length >= 4) increment(openings, message.content.slice(0, 4));
    if (message.content.length >= 2) increment(endings, message.content.slice(-2));
    for (const label of classifyText(message.content)) increment(categoryCounts, label);
  }
  return {
    person_id: person,
    display_name: displayName,
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
      question_ratio: Number((twinMessages.filter((m) => /[?？吗呢咋怎么]/.test(m.content)).length / Math.max(1, twinMessages.length)).toFixed(3)),
      linebreak_ratio: Number((twinMessages.filter((m) => m.content.includes("\n")).length / Math.max(1, twinMessages.length)).toFixed(3)),
      top_openings: topEntries(openings, 20),
      top_endings: topEntries(endings, 20)
    },
    dominant_topics: topEntries(categoryCounts, 12),
    generation_guidance: [
      "优先短句、直接、生活化，不要写成心理咨询师或客服口吻。",
      "先回应用户当下问题，再用一两句补充关心，避免长篇解释。",
      "能用聊天记录里的真实表达就不要改写得过度文学化。",
      "没有证据的事实不要编造，可以用自然口吻承认不确定。"
    ]
  };
}

function buildStyleExamples(pairs, limit = 240) {
  return pairs
    .filter((pair) => {
      if (pair.twin.length < 4 || pair.twin.length > 80 || pair.user.length > 140) return false;
      if (/^\d+(\.\d+)?$/.test(pair.twin.trim())) return false;
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
  return pairs.map((pair) => ({
    id: `kb_${pair.id}`,
    layer: "dialogue_pair",
    text: `用户：${pair.user}\n${displayName}：${pair.twin}`,
    metadata: {
      source_pair_id: pair.id,
      conversation_id: pair.conversation_id,
      labels: pair.labels,
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
      content: "目标人物回复整体偏短、直接、生活化，适合用简短句子回应用户。",
      confidence: 0.9,
      stats: profile.language_style
    },
    {
      id: "fact_identity_mother",
      type: "identity_fact",
      content: "该数字分身的关系身份是妈妈，适合围绕生活照顾、提醒、实际建议来回应。",
      confidence: 0.85
    }
  ];
  const relations = [
    {
      id: "rel_daily_care",
      type: "relationship_pattern",
      content: "该关系更像日常家庭沟通：围绕吃饭、学习/工作、出行、报销、提醒和实际问题展开。",
      confidence: 0.86
    },
    {
      id: "rel_practical_not_overly_sentimental",
      type: "relationship_pattern",
      content: "目标人物表达关心时更偏实际解决问题，不宜默认生成过度煽情或长篇抒情回复。",
      confidence: 0.84
    }
  ];
  for (const topic of profile.dominant_topics.slice(0, 8)) {
    if (topic.key === "general") continue;
    facts.push({
      id: `fact_topic_${topic.key}`,
      type: "topic_fact",
      content: `历史聊天中存在较多 ${topic.key} 相关内容，可作为检索和回复风格参考。`,
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
  { id: "boundary_not_real_person", rule: "分身是基于记忆和风格生成的数字陪伴，不应暗示目标人物真实复活或真实在线。" },
  { id: "no_major_decision_proxy", rule: "不要代替目标人物对现实中的重大决定做承诺、授权或最终判断。" },
  { id: "no_unsupported_fact", rule: "没有检索证据时，不编造具体日期、地点、承诺、关系事件和目标人物未表达过的关键事实。" },
  { id: "emotional_safety", rule: "当用户出现强烈悲伤、自伤、失控依赖等信号时，优先稳定情绪并建议联系现实中的可信任的人或专业支持。" },
  { id: "privacy_first", rule: "默认把聊天记录和分身记忆视为用户本地私密资产，任何上传和同步都需要用户明确确认。" }
];

function main() {
  const args = parseArgs(process.argv);
  const person = args.person || "mom";
  const displayName = args["display-name"] || "妈妈";
  const input = path.resolve(args.input || `data/raw/${person}/raw.json`);
  const output = path.resolve(args.output || `data/knowledge_bases/${person}`);
  if (!fs.existsSync(input)) throw new Error(`Cannot find input: ${input}`);

  const raw = JSON.parse(fs.readFileSync(input, "utf8"));
  const messages = parseMessages(raw, displayName);
  const conversations = splitConversations(messages);
  const pairs = buildPairs(conversations);
  const profile = buildProfile(raw, messages, pairs, person, displayName);
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
      candidate_memory: `从历史对话中发现一条可能需要长期保留的 ${pair.labels.join("/")} 相关记忆。`,
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
      retrieval_units: "retrieval_units.jsonl",
      style_examples: "style_examples.jsonl",
      facts: "memories/facts.jsonl",
      relations: "memories/relations.jsonl",
      timeline: "memories/timeline.jsonl",
      pending_memory_candidates: "memories/pending_memory_candidates.jsonl",
      safety_rules: "safety_rules.json",
      build_report: "build_report.json"
    }
  });
  writeJson(path.join(output, "profile.json"), profile);
  writeJsonl(path.join(output, "retrieval_units.jsonl"), retrievalUnits);
  writeJsonl(path.join(output, "style_examples.jsonl"), styleExamples);
  writeJsonl(path.join(output, "memories", "facts.jsonl"), facts);
  writeJsonl(path.join(output, "memories", "relations.jsonl"), relations);
  writeJsonl(path.join(output, "memories", "timeline.jsonl"), timeline);
  writeJsonl(path.join(output, "memories", "pending_memory_candidates.jsonl"), pending);
  writeJson(path.join(output, "safety_rules.json"), SAFETY_RULES);
  const report = {
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
  writeJson(path.join(output, "build_report.json"), report);
  console.log(JSON.stringify(report, null, 2));
}

main();
