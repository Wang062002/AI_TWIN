import { CATEGORY_TERMS, classifyText, tokenize } from "./text.js";

function scoreText(queryTokens, text, labels, queryLabels) {
  const targetTokens = tokenize(text);
  let score = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) score += token.length > 1 ? 3 : 1;
  }
  for (const label of queryLabels) {
    if (label !== "general" && labels?.includes(label)) score += 18;
    for (const term of CATEGORY_TERMS[label] || []) {
      if (term.length > 1 && text.includes(term)) score += 8;
    }
  }
  const firstPhrase = [...queryTokens].find((t) => t.length > 1);
  if (firstPhrase && text.includes(firstPhrase)) score += 3;
  return score;
}

function isLowValueMemory(unit) {
  const text = unit.text || "";
  if (unit.metadata?.quality === "long") return true;
  if (text.length > 900) return true;
  const aiLikeMarkers = [
    "\u4e3a\u60a8\u8bbe\u8ba1",
    "\u4ee5\u4e0b\u662f",
    "\u6839\u636e\u60a8\u7684",
    "\u7ecf\u5178\u4e14\u5145\u5b9e\u7684\u884c\u7a0b",
    "DeepSeek",
    "ChatGPT"
  ];
  return aiLikeMarkers.some((marker) => text.includes(marker));
}

export function retrieveContext(kb, userInput, options = {}) {
  const topK = options.topK || 6;
  const styleK = options.styleK || 4;
  const maxUnitChars = options.maxUnitChars || 700;
  const queryTokens = tokenize(userInput);
  const queryLabels = classifyText(userInput);

  const memories = kb.retrievalUnits
    .filter((unit) => !isLowValueMemory(unit))
    .map((unit) => ({
      ...unit,
      score: scoreText(queryTokens, unit.text, unit.metadata?.labels, queryLabels)
    }))
    .filter((unit) => unit.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((unit) => ({
      ...unit,
      text: unit.text.length > maxUnitChars ? unit.text.slice(0, maxUnitChars) + "..." : unit.text
    }));

  const styles = kb.styleExamples
    .map((item) => ({
      ...item,
      score: scoreText(queryTokens, `${item.user}\n${item.target_reply}`, item.labels, queryLabels)
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, styleK);

  return { queryLabels, memories, styles };
}
