import { classifyText, tokenize } from "./text.js";

function scoreText(queryTokens, text, labels, queryLabels) {
  const targetTokens = tokenize(text);
  let score = 0;
  for (const token of queryTokens) {
    if (targetTokens.has(token)) score += token.length > 1 ? 3 : 1;
  }
  for (const label of queryLabels) {
    if (labels?.includes(label)) score += 4;
  }
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
    .sort((a, b) => b.score - a.score)
    .slice(0, styleK);

  return { queryLabels, memories, styles };
}
