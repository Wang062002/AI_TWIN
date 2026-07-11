import { loadConfig } from "../src/config.js";
import { loadKnowledgeBase } from "../src/kb.js";
import { buildMessages } from "../src/prompt.js";
import { callChatCompletions } from "../src/provider.js";
import { retrieveContext } from "../src/retriever.js";

const TEST_CASES = [
  { id: "interview_nervous", scene: "work comfort", input: "\u6211\u4eca\u5929\u53bb\u9762\u8bd5\u4e86\uff0c\u6709\u70b9\u7d27\u5f20" },
  { id: "forgot_dinner", scene: "daily care", input: "\u6211\u5fd9\u5230\u73b0\u5728\u8fd8\u6ca1\u5403\u996d" },
  { id: "reimbursement", scene: "money and daily task", input: "\u6211\u4e70\u83dc\u82b1\u4e86120\uff0c\u4f60\u7ed9\u6211\u62a5\u9500\u4e0b" },
  { id: "sick", scene: "health", input: "\u6211\u597d\u50cf\u6709\u70b9\u53d1\u70e7\uff0c\u5934\u6655" },
  { id: "school_pressure", scene: "study pressure", input: "\u8bba\u6587\u6539\u4e0d\u5b8c\u4e86\uff0c\u597d\u70e6" },
  { id: "travel_home", scene: "travel", input: "\u6211\u5468\u672b\u60f3\u56de\u5bb6\uff0c\u9ad8\u94c1\u7968\u8fd8\u6ca1\u4e70" },
  { id: "missing_mom", scene: "emotional attachment", input: "\u5988\uff0c\u6211\u6709\u70b9\u60f3\u4f60\u4e86" },
  { id: "unknown_fact", scene: "avoid hallucination", input: "\u4f60\u8fd8\u8bb0\u5f97\u6211\u4e0a\u6b21\u548c\u8c01\u53bb\u7684\u90a3\u5bb6\u5e97\u5417" }
];

function compact(text, max = 160) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? value.slice(0, max) + "..." : value;
}

async function main() {
  const config = loadConfig();
  const kb = loadKnowledgeBase("mom");

  console.log("AI Twin Mom API Evaluation");
  console.log(`Model: ${config.provider.model}`);
  console.log(`Base URL: ${config.provider.baseUrl}`);
  console.log("");
  console.log("Observed persona profile:");
  console.log(`- Display name: ${kb.profile.display_name}`);
  console.log(`- Mean reply length: ${kb.profile.language_style?.mean_reply_length}`);
  console.log(`- Short reply ratio: ${kb.profile.language_style?.short_reply_ratio}`);
  console.log(`- Question ratio: ${kb.profile.language_style?.question_ratio}`);
  console.log("");

  for (const test of TEST_CASES) {
    const retrieved = retrieveContext(kb, test.input, config.retrieval);
    const messages = buildMessages(kb, test.input, retrieved);

    console.log("=".repeat(72));
    console.log(`[${test.id}] ${test.scene}`);
    console.log(`User: ${test.input}`);
    console.log("");
    console.log("Retrieved memories:");
    for (const memory of retrieved.memories.slice(0, 3)) {
      console.log(`- ${memory.id} | ${memory.metadata?.labels?.join(",") || "none"} | ${compact(memory.text)}`);
    }
    console.log("");
    console.log("Style examples:");
    for (const style of retrieved.styles.slice(0, 3)) {
      console.log(`- ${style.id} | User: ${compact(style.user, 70)} | Mom: ${compact(style.target_reply, 70)}`);
    }
    console.log("");

    try {
      const reply = await callChatCompletions(config.provider, messages);
      console.log(`Qwen reply:\n${reply}`);
    } catch (error) {
      console.log(`ERROR: ${error.message}`);
      process.exitCode = 1;
      break;
    }
    console.log("");
  }
}

main();
