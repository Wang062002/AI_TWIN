export const CATEGORY_TERMS = {
  food: ["\u5403", "\u996d", "\u83dc", "\u4e70\u83dc", "\u505a\u996d", "\u665a\u996d", "\u5348\u996d", "\u65e9\u996d", "\u98df\u6750", "\u70e4\u7bb1", "\u6c34\u679c"],
  money: ["\u94b1", "\u62a5\u9500", "\u8f6c\u8d26", "\u4ed8\u6b3e", "\u7ea2\u5305", "\u652f\u4ed8\u5b9d", "\u5fae\u4fe1\u652f\u4ed8", "\u8d26\u5355"],
  study: ["\u5b66\u6821", "\u4e0a\u8bfe", "\u4f5c\u4e1a", "\u8003\u8bd5", "\u8001\u5e08", "\u8bba\u6587", "\u540c\u5b66", "\u8bfe\u7a0b", "\u6bd5\u4e1a"],
  work: ["\u5de5\u4f5c", "\u4e0a\u73ed", "\u4e0b\u73ed", "\u516c\u53f8", "\u9762\u8bd5", "\u8001\u677f", "\u540c\u4e8b", "\u7b80\u5386"],
  health: ["\u533b\u9662", "\u533b\u751f", "\u836f", "\u751f\u75c5", "\u53d1\u70e7", "\u7259", "\u75bc", "\u68c0\u67e5", "\u611f\u5192"],
  travel: ["\u8f66\u7968", "\u673a\u7968", "\u9ad8\u94c1", "\u98de\u673a", "\u9152\u5e97", "\u65c5\u884c", "\u51fa\u53bb", "\u56de\u5bb6"],
  comfort: ["\u7d27\u5f20", "\u96be\u53d7", "\u538b\u529b", "\u70e6", "\u7126\u8651", "\u5bb3\u6015", "\u59d4\u5c48", "\u54ed", "\u60f3\u4f60", "\u5931\u7720"]
};

const EMPTY_MARKERS = new Set([
  "[\u56fe\u7247]",
  "[\u89c6\u9891]",
  "[\u8bed\u97f3]",
  "[\u8868\u60c5]",
  "[\u6587\u4ef6]",
  "[\u94fe\u63a5]",
  "[\u4f4d\u7f6e]"
]);

export function cleanText(value) {
  const text = String(value || "")
    .replace(/\r/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text || EMPTY_MARKERS.has(text)) return "";
  if (/^https?:\/\//i.test(text)) return "";
  if (/^\[[^\]]+\]$/.test(text)) return "";
  return text;
}

export function classifyText(text) {
  const labels = [];
  for (const [label, terms] of Object.entries(CATEGORY_TERMS)) {
    if (terms.some((term) => text.includes(term))) labels.push(label);
  }
  return labels.length ? labels : ["general"];
}

export function tokenize(text) {
  const normalized = String(text || "").toLowerCase();
  const tokens = new Set();
  const chineseChars = normalized.match(/[\u4e00-\u9fff]/g) || [];
  for (const char of chineseChars) tokens.add(char);
  for (let i = 0; i < chineseChars.length - 1; i += 1) {
    tokens.add(chineseChars[i] + chineseChars[i + 1]);
  }
  for (const word of normalized.match(/[a-z0-9_]+/g) || []) {
    if (word.length > 1) tokens.add(word);
  }
  return tokens;
}

export function monthOf(ts) {
  const date = new Date(Number(ts || 0) * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

export function topEntries(map, limit = 20) {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

export function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}
