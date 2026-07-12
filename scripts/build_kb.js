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

function classifyReplyActs(text) {
  const value = String(text || "");
  const acts = [];
  if (value.length <= 4) acts.push("micro_reply");
  if (value.length <= 12) acts.push("short_reply");
  if (/[?\uff1f]|\u5417|\u5462|\u600e\u4e48|\u54ea/.test(value)) acts.push("question");
  if (/\u597d|\u884c|\u53ef\u4ee5|\u5bf9|\u786e\u5b9e|\u55ef|\u6602|ok/i.test(value)) acts.push("agreement");
  if (/\u4e0d|\u6ca1|\u522b|\u4e0d\u662f|\u4e0d\u884c/.test(value)) acts.push("negation");
  if (/\u54c8|\u7b11\u6b7b|hhh|233|\[\u7834\u6d95\u4e3a\u7b11\]|\[\u6342\u8138\]/i.test(value)) acts.push("humor_or_laughter");
  if (/\u50bb|\u5e9f\u7269|\u732a|\u722c|\u6eda|\u4f60\u5927\u575d|\u8001\u5f1f/.test(value)) acts.push("banter");
  if (/\u522b\u60f3|\u6ca1\u4e8b|\u4e0d\u6025|\u6162\u6162|\u52a0\u6cb9|\u6b63\u5e38/.test(value)) acts.push("comfort");
  if (/\u5e94\u8be5|\u8981\u4e0d|\u5efa\u8bae|\u53ef\u4ee5\u5148|\u4f60\u5148|\u8bd5\u8bd5/.test(value)) acts.push("advice");
  if (/\u51e0\u70b9|\u5728\u54ea|\u4e0b\u697c|\u5403\u996d|\u8fc7\u6765|\u51fa\u6765|\u665a\u4e0a|\u660e\u5929/.test(value)) acts.push("logistics");
  if (/\u4e0d\u77e5\u9053|\u4e0d\u8bb0\u5f97|\u5fd8\u4e86|\u4e0d\u6e05\u695a|\u53ef\u80fd/.test(value)) acts.push("uncertainty");
  if (/^\[[^\]]+\]$/.test(value.trim())) acts.push("emoji_only");
  return acts.length ? acts : ["plain_reply"];
}

function ratio(count, total) {
  return Number((count / Math.max(1, total)).toFixed(3));
}

function buildBehaviorStats(messages, pairs) {
  const userMessages = messages.filter((m) => m.role === "user");
  const twinMessages = messages.filter((m) => m.role === "twin");
  const userLengths = userMessages.map((m) => m.content.length);
  const twinLengths = twinMessages.map((m) => m.content.length);
  const actCounts = new Map();

  for (const message of twinMessages) {
    for (const act of classifyReplyActs(message.content)) increment(actCounts, act);
  }

  const pairUserLengths = pairs.map((pair) => pair.user.length);
  const pairTwinLengths = pairs.map((pair) => pair.twin.length);
  const twinLongerThanUser = pairs.filter((pair) => pair.twin.length > pair.user.length).length;
  const twinAsksBack = pairs.filter((pair) => /[?\uff1f]|\u5417|\u5462|\u600e\u4e48|\u54ea/.test(pair.twin)).length;

  const meanUserLength = Number((pairUserLengths.reduce((a, b) => a + b, 0) / Math.max(1, pairUserLengths.length)).toFixed(1));
  const meanTwinLength = Number((pairTwinLengths.reduce((a, b) => a + b, 0) / Math.max(1, pairTwinLengths.length)).toFixed(1));

  return {
    user_message_style: {
      mean_length: Number((userLengths.reduce((a, b) => a + b, 0) / Math.max(1, userLengths.length)).toFixed(1)),
      median_length: percentile(userLengths, 0.5),
      short_message_ratio: ratio(userMessages.filter((m) => m.content.length <= 12).length, userMessages.length)
    },
    target_reply_acts: topEntries(actCounts, 16).map((item) => ({
      ...item,
      ratio: ratio(item.count, twinMessages.length)
    })),
    interaction_rhythm: {
      mean_user_prompt_length: meanUserLength,
      mean_target_reply_length: meanTwinLength,
      target_to_user_length_ratio: Number((meanTwinLength / Math.max(1, meanUserLength)).toFixed(2)),
      target_longer_than_user_ratio: ratio(twinLongerThanUser, pairs.length),
      target_asks_back_ratio: ratio(twinAsksBack, pairs.length)
    }
  };
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
  const behaviorStats = buildBehaviorStats(messages, pairs);

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
    behavior_style: behaviorStats,
    pair_quality: topEntries(qualityCounts, 10),
    generation_guidance: [
      "Reply in natural Chinese.",
      "Prefer short, direct, everyday chat messages.",
      "Follow the configured relationship identity; do not assume every target person is a mother.",
      "Match the emotional distance, familiarity, humor, and level of care shown in this target person's real chat data.",
      "Do not add a caring reminder unless the retrieved dialogue or style examples support that behavior.",
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
    behavior_style_reference: profile.behavior_style,
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
  const topActs = profile.behavior_style?.target_reply_acts || [];
  const topActText = topActs.slice(0, 5).map((item) => `${item.key}:${item.ratio}`).join(", ") || "unknown";
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
    },
    {
      id: "fact_behavior_response_acts",
      type: "style_fact",
      content: `Observed target reply act distribution includes: ${topActText}. Use these as style signals, not as hard-coded role assumptions.`,
      confidence: 0.82,
      stats: profile.behavior_style
    }
  ];
  const relations = [
    {
      id: "rel_observed_interaction",
      type: "relationship_pattern",
      content: "The relationship pattern must be inferred from this person's chat data. Frequent topics and style samples should drive the reply more than any hard-coded identity assumption.",
      confidence: 0.86
    },
    {
      id: "rel_observed_message_style",
      type: "relationship_pattern",
      content: `Observed replies average ${profile.language_style.mean_reply_length} characters, with a short-reply ratio of ${profile.language_style.short_reply_ratio}. Match this measured communication rhythm without assuming a family or romantic role.`,
      confidence: 0.9
    },
    {
      id: "rel_observed_interaction_rhythm",
      type: "relationship_pattern",
      content: `Observed interaction rhythm: user prompts average ${profile.behavior_style.interaction_rhythm.mean_user_prompt_length} characters, target replies average ${profile.behavior_style.interaction_rhythm.mean_target_reply_length} characters, and target asks back in ${profile.behavior_style.interaction_rhythm.target_asks_back_ratio} of dialogue pairs.`,
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

const MEMORY_CATEGORY_PRIORITY = {
  life_event: 90,
  health: 85,
  work: 80,
  study: 75,
  personal_fact: 70,
  preference: 65,
  emotional_state: 60,
  event_context: 20
};

function classifyMemoryCandidate(pair) {
  const text = `${pair.user}\n${pair.twin}`;
  const categories = [];
  const reasons = [];
  let confidence = 0.45;

  if (/\u559c\u6b22|\u4e0d\u559c\u6b22|\u7231\u5403|\u4e0d\u5403|\u8ba8\u538c|\u60f3\u8981|\u504f\u597d|\u4e60\u60ef/.test(text)) {
    categories.push("preference");
    reasons.push("preference_or_habit_signal");
    confidence += 0.18;
  }
  if (/\u6211\u5728|\u6211\u53bb|\u6211\u8981|\u6211\u5df2\u7ecf|\u6211\u51c6\u5907|\u6211\u6700\u8fd1|\u6211\u73b0\u5728/.test(pair.user)) {
    categories.push("personal_fact");
    reasons.push("user_self_statement");
    confidence += 0.12;
  }
  if (/\u5de5\u4f5c|\u4e0a\u73ed|\u9762\u8bd5|\u516c\u53f8|\u8001\u677f|\u79bb\u804c|\u7b80\u5386/.test(text)) {
    categories.push("work");
    reasons.push("work_related");
    confidence += 0.1;
  }
  if (/\u5b66\u6821|\u4e0a\u8bfe|\u8003\u8bd5|\u4f5c\u4e1a|\u8bba\u6587|\u6bd5\u4e1a|\u4e13\u4e1a/.test(text)) {
    categories.push("study");
    reasons.push("study_related");
    confidence += 0.1;
  }
  if (/\u533b\u9662|\u751f\u75c5|\u53d1\u70e7|\u611f\u5192|\u7259|\u836f|\u75bc|\u68c0\u67e5/.test(text)) {
    categories.push("health");
    reasons.push("health_related");
    confidence += 0.12;
  }
  if (/\u642c\u5bb6|\u53bb\u4e16|\u5206\u624b|\u7ed3\u5a5a|\u6bd5\u4e1a|\u5165\u804c|\u79bb\u804c|\u9762\u8bd5|\u8003\u8bd5/.test(text)) {
    categories.push("life_event");
    reasons.push("life_event_signal");
    confidence += 0.16;
  }
  if (/\u96be\u53d7|\u7126\u8651|\u5931\u7720|\u538b\u529b|\u5d29\u6e83|\u60f3\u4f60|\u5f00\u5fc3|\u751f\u6c14|\u59d4\u5c48/.test(text)) {
    categories.push("emotional_state");
    reasons.push("emotion_signal");
    confidence += 0.1;
  }
  if (/\u4e0a\u6b21|\u4eca\u5929|\u660e\u5929|\u665a\u4e0a|\u5468\u672b|\u6708|\u5e74|\u53bb\u4e86|\u6765\u4e86/.test(text)) {
    categories.push("event_context");
    reasons.push("time_or_event_context");
    confidence += 0.06;
  }

  if (!categories.length) return null;
  if (pair.user.length <= 2 && pair.twin.length <= 4) return null;
  if (pair.user.length > 220 || pair.twin.length > 220) return null;
  if (["number_only", "ai_like_long", "long"].includes(pair.quality)) return null;

  const uniqueCategories = [...new Set(categories)];
  const durableCategories = uniqueCategories.filter((category) => category !== "event_context");
  if (!durableCategories.length) return null;

  const sortedCategories = [...uniqueCategories].sort((a, b) => {
    return (MEMORY_CATEGORY_PRIORITY[b] || 0) - (MEMORY_CATEGORY_PRIORITY[a] || 0);
  });
  const selectedCategories = sortedCategories.slice(0, 3);
  const primaryCategory = selectedCategories.find((category) => category !== "event_context") || selectedCategories[0];
  if (selectedCategories.length > 2) confidence -= 0.04;
  if (pair.user.length < 6 && pair.twin.length < 6) confidence -= 0.08;
  confidence = Number(Math.min(0.95, confidence).toFixed(2));
  if (confidence < 0.58) return null;

  return {
    primary_category: primaryCategory,
    categories: selectedCategories,
    reasons: [...new Set(reasons)],
    confidence
  };
}

function buildPendingMemoryCandidates(pairs, limit = 80) {
  const sorted = pairs
    .map((pair) => ({ pair, candidate: classifyMemoryCandidate(pair) }))
    .filter((item) => item.candidate)
    .sort((a, b) => {
      if (b.candidate.confidence !== a.candidate.confidence) return b.candidate.confidence - a.candidate.confidence;
      return String(b.pair.time || "").localeCompare(String(a.pair.time || ""));
    });

  const selected = [];
  const primaryCounts = new Map();
  const softCap = Math.max(12, Math.ceil(limit / 4));
  for (const item of sorted) {
    const primary = item.candidate.primary_category;
    const count = primaryCounts.get(primary) || 0;
    if (count >= softCap && selected.length < Math.floor(limit * 0.75)) continue;
    selected.push(item);
    primaryCounts.set(primary, count + 1);
    if (selected.length >= limit) break;
  }

  return selected
    .map((item, index) => ({
      id: `pending_${String(index + 1).padStart(4, "0")}`,
      status: "pending_user_confirm",
      memory_type: item.candidate.primary_category,
      memory_categories: item.candidate.categories,
      confidence: item.candidate.confidence,
      candidate_memory: `Historical dialogue may contain a ${item.candidate.categories.join("/")} memory. User confirmation is required before storing it as durable memory.`,
      reasons: item.candidate.reasons,
      source_pair_id: item.pair.id,
      evidence: { user: item.pair.user, twin: item.pair.twin, time: item.pair.time },
      suggested_actions: ["confirm", "edit", "delete"]
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
  const pending = buildPendingMemoryCandidates(pairs);
  const pendingTypeCounts = new Map();
  const pendingPrimaryTypeCounts = new Map();
  for (const item of pending) {
    increment(pendingPrimaryTypeCounts, item.memory_type);
    for (const category of item.memory_categories) increment(pendingTypeCounts, category);
  }

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
    quality_distribution: profile.pair_quality,
    pending_memory_primary_type_distribution: topEntries(pendingPrimaryTypeCounts, 12),
    pending_memory_type_distribution: topEntries(pendingTypeCounts, 12)
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
    pending_memory_candidate_count: pending.length,
    pending_memory_primary_type_distribution: topEntries(pendingPrimaryTypeCounts, 12),
    pending_memory_type_distribution: topEntries(pendingTypeCounts, 12)
  };
  writeJson(path.join(output, "build_report.json"), buildReport);
  console.log(JSON.stringify(buildReport, null, 2));
}

main();
