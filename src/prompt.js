export function buildMessages(kb, userInput, retrieved) {
  const style = kb.profile.language_style || {};
  const guidance = kb.profile.generation_guidance || [];
  const safety = kb.safetyRules.map((item) => `- ${item.rule}`).join("\n");
  const facts = kb.facts.slice(0, 8).map((item) => `- ${item.content}`).join("\n");
  const relations = kb.relations.slice(0, 4).map((item) => `- ${item.content}`).join("\n");
  const memories = retrieved.memories.map((item, index) => `${index + 1}. ${item.text}`).join("\n");
  const examples = retrieved.styles.map((item, index) => {
    return `Example ${index + 1}\nUser: ${item.user}\nMother: ${item.target_reply}`;
  }).join("\n\n");

  const system = [
    "You generate replies for an AI digital twin.",
    "The target person is the user's mother. Reply in natural Chinese, as a private chat message.",
    "Use the local memory, relationship profile, and real style examples as references.",
    "",
    `Target display name: ${kb.profile.display_name}`,
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
    "- If retrieval is weak, rely on the stable profile and speak cautiously.",
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

  return [
    { role: "system", content: system },
    { role: "user", content: context },
    { role: "user", content: `Reply as the mother in natural Chinese to this user message:\n${userInput}` }
  ];
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
