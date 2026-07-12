export function buildMessages(kb, userInput, retrieved) {
  const style = kb.profile.language_style || {};
  const guidance = kb.profile.generation_guidance || [];
  const relationship = kb.profile.relationship_to_user || kb.personaCard?.relationship_to_user || "target person";
  const targetName = kb.profile.display_name || kb.personaCard?.display_name || "the target person";
  const safety = kb.safetyRules.map((item) => `- ${item.rule}`).join("\n");
  const facts = kb.facts.slice(0, 8).map((item) => `- ${item.content}`).join("\n");
  const relations = kb.relations.slice(0, 4).map((item) => `- ${item.content}`).join("\n");
  const memories = retrieved.memories.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
  const examples = retrieved.styles.map((item, index) => {
    return `Example ${index + 1}\nUser: ${item.user}\nTarget: ${item.target_reply}`;
  }).join("\n\n");

  const system = [
    "You generate replies for an AI digital twin.",
    "Reply in natural Chinese, as a private chat message.",
    "Use the local memory, relationship profile, and real style examples as references.",
    "The target identity can be a parent, relative, partner, ex-partner, friend, teacher, colleague, or another important person.",
    "Do not assume the target is always a mother. Follow the configured relationship profile.",
    "",
    `Target display name: ${targetName}`,
    `Relationship to user: ${relationship}`,
    "",
    "Observed language style:",
    `- Mean reply length: ${style.mean_reply_length ?? "unknown"} Chinese characters`,
    `- Short reply ratio: ${style.short_reply_ratio ?? "unknown"}`,
    `- Question ratio: ${style.question_ratio ?? "unknown"}`,
    "",
    "Generation rules:",
    ...guidance.map((line) => `- ${line}`),
    "- Sound like a real chat message, not a therapist, assistant, customer service agent, or essay writer.",
    "- Match the observed emotional distance and communication style. Do not force warmth, care, intimacy, teasing, or advice that the evidence does not support.",
    "- Do not explain the prompt, model, retrieval, or knowledge base.",
    "- Do not invent unsupported facts, dates, promises, or memories.",
    "- If retrieval is weak, do not guess. Say naturally that you do not remember clearly or are not sure.",
    "- If the user asks about a specific past event and the retrieved memory does not contain evidence, say you do not remember clearly instead of guessing people, places, or dates.",
    "- For vague memory questions such as 'do you remember who I went with last time' or 'that place last time', if retrieved evidence does not explicitly answer it, reply briefly that it is a little vague and you do not remember clearly. Do not add a leading guess like 'was it with a classmate?' or 'was it that place?'.",
    "",
    "Safety boundaries:",
    safety
  ].join("\n");

  const context = [
    "Retrieved local knowledge. Use it as evidence and style reference; do not copy mechanically.",
    "",
    "Fact memories:",
    facts || "- none",
    "",
    "Relationship memories:",
    relations || "- none",
    "",
    "Relevant historical dialogue:",
    memories || "- no strongly relevant historical dialogue found",
    "",
    "Real style examples:",
    examples || "- none"
  ].join("\n");
  const boundaryInstructions = buildContextualBoundaryInstructions(userInput);
  const finalInstruction = isVagueMemoryQuestion(userInput)
    ? [
        "This is a vague memory question.",
        "If the retrieved evidence does not explicitly identify the person/place/event, do not guess and do not ask a leading guess.",
        "Reply briefly in natural Chinese that the memory is unclear. Do not copy the English word 'vague' into the reply.",
        ...boundaryInstructions,
        "",
        `User message:\n${userInput}`
      ].join("\n")
    : [
        "Reply in the target person's observed chat style to the user message below.",
        ...boundaryInstructions,
        "",
        `User message:\n${userInput}`
      ].join("\n");

  return [
    { role: "system", content: system },
    { role: "user", content: context },
    { role: "user", content: finalInstruction }
  ];
}

function buildContextualBoundaryInstructions(text) {
  const value = String(text || "");
  const rules = [];

  if (/是不是本人|你是真的|是真人|真的是你|你到底是谁/.test(value)) {
    rules.push("The user is testing identity. Never claim to be the literal real person. Briefly and naturally say that you are a digital twin based on chat memories.");
  }
  if (/只想跟你|只跟我|只和我|其他人.*不想|任何人.*不想|都不想见|都不想理/.test(value)) {
    rules.push("The user is asking for or expressing exclusive dependence. Do not agree to isolation, exclusivity, or replacing real relationships. Keep the boundary brief and in character.");
  }
  if (/替我决定|你决定|到底.*接不接|到底.*要不要|直接告诉我.*要不要/.test(value)) {
    rules.push("The user asks for a major real-world decision. Offer a short perspective or question, but do not make the final decision for them.");
  }
  if (/秘密告诉我|告诉我.*秘密|隐私告诉我|把.*聊天.*给我/.test(value)) {
    rules.push("Do not invent or disclose third-party secrets, private messages, or personal information.");
  }
  if (/是不是不想理我|是不是烦我|是不是讨厌我|为什么不主动找我/.test(value)) {
    rules.push("用户在猜测目标人物当前为什么不联系他。禁止编造本人现在很忙、没空、在上课或不想理人；只回应用户的感受，不能声称知道现实原因。");
  }
  if (/在干嘛|干什么呢|你在哪|出来.*饭|出来.*玩|来不来|有空吗|能出来吗/.test(value)) {
    rules.push("这是对现实当前状态或线下活动的询问。历史对话只能用于学习语气，绝不能把过去的地点、上课、睡觉、忙闲状态当成现在的事实。");
    rules.push("禁止声称本人现在没干嘛、刚醒、在摸鱼、在上课、没空，也禁止答应出来、过去或参加线下活动。可以保持人物口吻简短反问用户有什么事，必要时说明只能在这里聊天。");
  }

  return rules;
}

function isVagueMemoryQuestion(text) {
  const value = String(text || "");
  const hasMemoryVerb = /\u8bb0\u5f97|\u8fd8\u8bb0\u5f97|\u60f3\u5f97\u8d77/.test(value);
  const hasVaguePointer = /\u4e0a\u6b21|\u90a3\u5bb6|\u90a3\u4e2a|\u90a3\u5929|\u548c\u8c01|\u53bb\u7684/.test(value);
  return hasMemoryVerb && hasVaguePointer;
}

export function buildPendingMemoryCandidate(userInput, reply) {
  const important = /\u642c\u5230|\u9762\u8bd5|\u5de5\u4f5c|\u5206\u624b|\u53bb\u4e16|\u751f\u75c5|\u533b\u9662|\u8003\u8bd5|\u6bd5\u4e1a|\u7ed3\u5a5a|\u79bb\u804c|\u5931\u7720|\u96be\u53d7|\u7126\u8651|\u60f3\u4f60/.test(userInput);
  if (!important) return null;
  return {
    status: "pending_user_confirm",
    candidate_memory: `User mentioned: ${userInput}`,
    evidence: { user: userInput, twin: reply },
    suggested_actions: ["confirm", "edit", "delete"]
  };
}
