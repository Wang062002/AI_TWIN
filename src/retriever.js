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

export function retrieveContext(kb, userInput, options = {}) {
  const topK = options.topK || 6;
  const styleK = options.styleK || 4;
  const maxUnitChars = options.maxUnitChars || 700;
  const queryTokens = tokenize(userInput);
  const queryLabels = classifyText(userInput);

  const memories = kb.retrievalUnits
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
