import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { loadConfig } from "../src/config.js";
import { loadKnowledgeBaseFromDir } from "../src/kb.js";
import { loadPersonConfig } from "../src/person_config.js";
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
  if (style && userInput.length < 30) return `${style}\n\u4f60\u5148\u522b\u6025\uff0c\u6162\u6162\u8bf4\u3002`;
  if (/\u7d27\u5f20|\u7126\u8651|\u96be\u53d7|\u5931\u7720|\u60f3\u4f60/.test(userInput)) {
    return "\u522b\u60f3\u592a\u591a\uff0c\u5148\u597d\u597d\u4f11\u606f\u3002\u6709\u4ec0\u4e48\u4e8b\u6162\u6162\u8bf4\u3002";
  }
  if (/\u5403|\u996d/.test(userInput)) return "\u5403\u70b9\u4e1c\u897f\uff0c\u522b\u997f\u7740\u3002";
  return "\u55ef\u55ef\uff0c\u6211\u77e5\u9053\u4e86\u3002\u4f60\u6162\u6162\u8bf4\u3002";
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.person) {
    throw new Error("Missing --person. Example: npm run chat:mock -- --person mom");
  }
  const person = String(args.person).trim();
  const mock = Boolean(args.mock);
  const preview = Boolean(args.preview);
  const config = loadConfig();
  const personConfig = loadPersonConfig(person, { config: args.config });
  const kb = loadKnowledgeBaseFromDir(personConfig.knowledge_base_output);
  const oneShotMessage = args.message ? String(args.message).trim() : "";
  const rl = oneShotMessage ? null : readline.createInterface({ input, output });

  console.log(`AI Twin chat demo: ${kb.profile.display_name}`);
  console.log(mock ? "Mode: mock, no real API call." : `Model: ${config.provider.model || "(not configured)"}`);
  if (!oneShotMessage) console.log("Type exit to quit.\n");

  async function handleMessage(userInput) {
    if (!userInput) return;

    const retrieved = retrieveContext(kb, userInput, config.retrieval);
    const messages = buildMessages(kb, userInput, retrieved);

    if (preview || process.env.AI_TWIN_DEBUG === "true") {
      console.log("\n[debug] retrieved memories:", retrieved.memories.map((m) => m.id).join(", ") || "none");
      console.log("[debug] style examples:", retrieved.styles.map((s) => s.id).join(", ") || "none");
      if (preview) {
        console.log("\n[prompt preview]");
        console.log(messages.map((m) => `--- ${m.role} ---\n${m.content}`).join("\n"));
        console.log("[/prompt preview]\n");
      }
    }

    let reply;
    if (mock) {
      reply = mockReply(userInput, retrieved);
    } else {
      reply = await callChatCompletions(config.provider, messages);
    }

    console.log(`${kb.profile.display_name}: ${reply}\n`);
    const pending = buildPendingMemoryCandidate(userInput, reply);
    if (pending) {
      console.log(`[Pending memory] ${pending.candidate_memory}`);
      console.log("Later product UI should ask: remember / edit / delete.\n");
    }
  }

  if (oneShotMessage) {
    await handleMessage(oneShotMessage);
    return;
  }

  while (true) {
    const userInput = (await rl.question("You: ")).trim();
    if (!userInput) continue;
    if (["exit", "quit", "q"].includes(userInput.toLowerCase())) break;
    await handleMessage(userInput);
  }

  rl.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
