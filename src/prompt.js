export function buildMessages(kb, userInput, retrieved) {
  const style = kb.profile.language_style || {};
  const guidance = kb.profile.generation_guidance || [];
  const safety = kb.safetyRules.map((item) => `- ${item.rule}`).join("\n");
  const facts = kb.facts.slice(0, 8).map((item) => `- ${item.content}`).join("\n");
  const relations = kb.relations.slice(0, 4).map((item) => `- ${item.content}`).join("\n");
  const memories = retrieved.memories.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
  const examples = retrieved.styles.map((item, index) => {
    return `示例 ${index + 1}\n用户：${item.user}\n妈妈：${item.target_reply}`;
  }).join("\n\n");

  const system = [
    "你是一个数字分身回复生成器。你的任务是根据本地知识库、关系记忆和真实风格样本，生成目标人物风格的聊天回复。",
    "",
    `目标人物：${kb.profile.display_name}`,
    "关系身份：妈妈",
    "",
    "语言风格统计：",
    `- 平均回复长度：${style.mean_reply_length ?? "未知"} 字`,
    `- 短回复比例：${style.short_reply_ratio ?? "未知"}`,
    `- 问句比例：${style.question_ratio ?? "未知"}`,
    "",
    "生成原则：",
    ...guidance.map((line) => `- ${line}`),
    "- 回复要自然像聊天，不要解释你用了什么知识库或模型。",
    "- 优先短句、生活化、直接关心，避免过度文学化、心理咨询师口吻或客服口吻。",
    "- 不确定的事实不要编造，可以用目标人物风格自然地表达不确定。",
    "",
    "安全边界：",
    safety
  ].join("\n");

  const context = [
    "下面是从本地知识库检索到的资料。它们是辅助你模仿目标人物的依据，不要逐字复述。",
    "",
    "关系/事实记忆：",
    facts || "- 暂无",
    relations || "",
    "",
    "相关历史对话：",
    memories || "- 没有检索到强相关历史对话，此时更依赖人物画像和风格样本。",
    "",
    "真实风格样本：",
    examples || "- 暂无同主题样本。"
  ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: context },
    { role: "user", content: `请用“妈妈”的口吻回复用户这句话：${userInput}` }
  ];
}

export function buildPendingMemoryCandidate(userInput, reply) {
  const important = /搬到|面试|工作|分手|去世|生病|医院|考试|毕业|结婚|离职|失眠|难受|焦虑|想你/.test(userInput);
  if (!important) return null;
  return {
    status: "pending_user_confirm",
    candidate_memory: `用户提到：${userInput}`,
    evidence: { user: userInput, twin: reply },
    suggested_actions: ["confirm", "edit", "delete"]
  };
}
