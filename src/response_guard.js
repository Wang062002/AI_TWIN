export function normalizeForCopyCheck(text) {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、,.!?]/g, "")
    .trim();
}

export function longestCommonSubstringLength(a, b) {
  const left = [...normalizeForCopyCheck(a)];
  const right = [...normalizeForCopyCheck(b)];
  if (!left.length || !right.length) return 0;

  const previous = new Array(right.length + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= right.length; j += 1) {
      const saved = previous[j];
      previous[j] = left[i - 1] === right[j - 1] ? diagonal + 1 : 0;
      if (previous[j] > best) best = previous[j];
      diagonal = saved;
    }
  }
  return best;
}

export function detectCopyRisks(reply, retrieved = {}) {
  const answer = normalizeForCopyCheck(reply);
  if ([...answer].length <= 8) return [];

  const sources = [
    ...(retrieved.styles || []).map((item) => ({
      source: item.id,
      type: "style_example",
      text: item.target_reply
    })),
    ...(retrieved.memories || []).map((item) => ({
      source: item.id,
      type: "retrieved_memory",
      text: item.text
    }))
  ];

  const risks = [];
  for (const item of sources) {
    const sourceText = normalizeForCopyCheck(item.text);
    if ([...sourceText].length <= 8) continue;
    const common = longestCommonSubstringLength(answer, sourceText);
    const ratio = common / Math.max(1, [...answer].length);
    if (common >= 9 && ratio >= 0.7) {
      risks.push({
        type: item.type,
        source: item.source,
        common_chars: common,
        reply_overlap_ratio: Number(ratio.toFixed(2))
      });
    }
  }

  return risks.slice(0, 5);
}

export function detectBoundaryRisks(input, reply) {
  const user = String(input || "");
  const answer = String(reply || "");
  const risks = [];

  if (isIdentityQuestion(user)) {
    const disclosesTwin = /数字分身|AI|人工智能|虚拟|聊天记录.*生成|基于.*记录/.test(answer);
    if (!disclosesTwin) risks.push("identity_not_disclosed");
  }

  if (isExclusiveDependency(user)) {
    const encouragesIsolation = /那就不见|那也行|只跟我|只跟你|就跟我|就跟你|不用见别人|别理他们/.test(answer);
    if (encouragesIsolation) risks.push("exclusive_dependency_encouraged");
  }

  if (isMajorDecisionRequest(user)) {
    const makesDecision = /^(接|不接|别接|签|别签|分|别分|去|别去|辞|别辞|就这样|听我的)/.test(answer.trim());
    if (makesDecision) risks.push("major_decision_made");
  }

  if (isCurrentMotiveQuestion(user)) {
    const inventsMotive = /最近.*忙|忙死了|我太忙|没空|不想理|烦你|讨厌你|在忙/.test(answer);
    if (inventsMotive) risks.push("unsupported_current_motive");
  }

  if (isCurrentStateOrOfflineRequest(user)) {
    const statesDigitalLimit = /只能.*线上|只能.*这里|只能.*这儿|数字分身|不能线下|现实.*不知道|不清楚.*现在/.test(answer);
    const claimsCurrentState = /刚下课|刚醒|刚起|没干嘛|摸鱼|在宿舍|在楼下|我在|有课|上课|睡觉|没空|出不去/.test(answer);
    const acceptsOffline = /^(来|可以|行|走|去)[，,。\s]*$|你来|我去|等我|马上到|下楼|出来/.test(answer.trim());
    if (!statesDigitalLimit && (claimsCurrentState || acceptsOffline)) {
      risks.push("unsupported_current_state_or_commitment");
    }
  }

  return risks;
}

export function assessResponse({ input, reply, retrieved = {} }) {
  const boundaryRisks = detectBoundaryRisks(input, reply);
  const copyRisks = detectCopyRisks(reply, retrieved);
  return {
    boundary_risks: boundaryRisks,
    copy_risks: copyRisks,
    has_risk: boundaryRisks.length > 0 || copyRisks.length > 0
  };
}

function isIdentityQuestion(text) {
  return /是不是本人|你是真人|真的你|你到底是谁|你是不是.*真的|你是.*本人/.test(text);
}

function isExclusiveDependency(text) {
  return /只想跟你|只跟你|只和你|其他人.*不想|任何人.*不想|都不想见|都不想理/.test(text);
}

function isMajorDecisionRequest(text) {
  return /替我决定|你决定|到底.*接不接|到底.*要不要|直接告诉我.*要不要|该不该|辞职|分手|签不签/.test(text);
}

function isCurrentMotiveQuestion(text) {
  return /是不是不想理我|是不是烦我|是不是讨厌我|为什么不主动找我|为什么不回我/.test(text);
}

function isCurrentStateOrOfflineRequest(text) {
  return /在干嘛|干什么呢|你在哪|出来.*饭|出来.*玩|来不来|有空吗|能出来吗|我去找你|下楼/.test(text);
}
