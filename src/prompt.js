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
    "- Prefer short, direct, practical, caring replies.",
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
  const finalInstruction = isVagueMemoryQuestion(userInput)
    ? [
        "This is a vague memory question.",
        "If the retrieved evidence does not explicitly identify the person/place/event, do not guess and do not ask a leading guess.",
        "Reply briefly in Chinese that it is a little vague and you do not remember clearly.",
        "",
        `User message:\n${userInput}`
      ].join("\n")
    : `Reply as the target person in natural Chinese to this user message:\n${userInput}`;

  return [
    { role: "system", content: system },
    { role: "user", content: context },
    { role: "user", content: finalInstruction }
  ];
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
