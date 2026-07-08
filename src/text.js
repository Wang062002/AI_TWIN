export const CATEGORY_TERMS = {
  food: ["吃", "饭", "菜", "买菜", "做饭", "晚饭", "午饭", "早餐", "食材", "烤箱", "水果"],
  money: ["钱", "报销", "转账", "付款", "红包", "支付宝", "微信支付", "账单"],
  study: ["学校", "上课", "作业", "考试", "老师", "论文", "同学", "课程", "毕业"],
  work: ["工作", "上班", "下班", "公司", "面试", "老板", "同事", "简历"],
  health: ["医院", "医生", "药", "生病", "发烧", "牙", "疼", "检查", "感冒"],
  travel: ["车票", "机票", "高铁", "飞机", "酒店", "旅行", "出去", "回家"],
  comfort: ["紧张", "难受", "压力", "烦", "焦虑", "害怕", "委屈", "哭", "想你", "失眠"]
};

const EMPTY_MARKERS = new Set(["[图片]", "[视频]", "[语音]", "[表情]", "[文件]", "[链接]", "[位置]"]);

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
