import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../src/config.js";
import { loadKnowledgeBase } from "../src/kb.js";
import { buildMessages, buildPendingMemoryCandidate } from "../src/prompt.js";
import { callChatCompletions } from "../src/provider.js";
import { retrieveContext } from "../src/retriever.js";

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

function mockReply(userInput, retrieved) {
  const style = retrieved.styles[0]?.target_reply;
  if (style && userInput.length < 30) return `${style}\n你先别急，慢慢说。`;
  if (/紧张|焦虑|难受|失眠|想你/.test(userInput)) return "别想太多，先好好休息。有什么事慢慢说。";
  if (/吃|饭/.test(userInput)) return "吃点东西，别饿着。";
  return "嗯嗯，我知道了。你慢慢说。";
}

async function main() {
  const args = parseArgs(process.argv);
  const person = args.person || "mom";
  const mock = Boolean(args.mock);
  const config = loadConfig();
  const kb = loadKnowledgeBase(person);
  const rl = readline.createInterface({ input, output });

  console.log(`AI Twin chat demo: ${kb.profile.display_name}`);
  console.log(mock ? "当前为 mock 模式，不调用真实 API。" : `当前模型：${config.provider.model || "(未配置)"}`);
  console.log("输入 exit 退出。\n");

  while (true) {
    const userInput = (await rl.question("你：")).trim();
    if (!userInput) continue;
    if (["exit", "quit", "q"].includes(userInput.toLowerCase())) break;

    const retrieved = retrieveContext(kb, userInput, config.retrieval);
    const messages = buildMessages(kb, userInput, retrieved);

    if (process.env.AI_TWIN_DEBUG === "true") {
      console.log("\n[debug] retrieved memories:", retrieved.memories.map((m) => m.id).join(", ") || "none");
      console.log("[debug] style examples:", retrieved.styles.map((s) => s.id).join(", ") || "none");
    }

    let reply;
    if (mock) {
      reply = mockReply(userInput, retrieved);
    } else {
      reply = await callChatCompletions(config.provider, messages);
    }

    console.log(`妈妈：${reply}\n`);
    const pending = buildPendingMemoryCandidate(userInput, reply);
    if (pending) {
      console.log(`[待确认记忆] ${pending.candidate_memory}`);
      console.log("后续产品里这里会让用户选择：记住 / 编辑 / 删除。\n");
    }
  }

  rl.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
