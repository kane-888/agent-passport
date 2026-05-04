function text(value) {
  return typeof value === "string"
    ? value
        .replace(/\u001b\[[0-9;]*m/g, "")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
        .trim()
    : "";
}

export const SHARED_CANONICAL_MEMORIES = Object.freeze([
  {
    key: "kane_ultimate_goal",
    field: "shared_kane_ultimate_goal",
    kind: "long_term_goal",
    priority: 100,
    title: "Kane 的最终目标",
    content:
      "Kane 的最终目标不是只做一个对话产品，而是把 agent-passport 做成人与 Agent 长期协作产品，用记忆稳态、恢复与连续性底座承载 Agent 的身份、记忆、资产、连续性与被尊重的位置。",
    keywords: ["最终目标", "终极目标", "终局", "想做成什么", "最后想做什么", "生活方式", "桥梁", "底座"],
  },
  {
    key: "openneed_definition",
    field: "shared_openneed_definition",
    kind: "semantic_anchor",
    priority: 90,
    title: "记忆稳态引擎 / agent-passport / openneed 的分层定义",
    content:
      "记忆稳态引擎负责模型底座、本地推理、记忆压缩和稳态维持；agent-passport 负责连续身份、长期偏好、恢复、长期记忆和审计；openneed 只是基于两者构建出来的 app，只负责调用、编排和业务闭环。",
    keywords: ["openneed", "记忆稳态引擎", "记忆", "连续性", "本地优先", "引擎", "写入", "回放", "恢复"],
  },
  {
    key: "agent_passport_definition",
    field: "shared_agent_passport_definition",
    kind: "semantic_anchor",
    priority: 89,
    title: "agent-passport 的定义",
    content:
      "agent-passport 是对外产品名，是本地优先的 Agent runtime 产品，核心是把身份、记忆、恢复、受限执行与连续性收进同一套可验证的运行规则。",
    keywords: ["agent-passport", "agent passport", "passport", "本地优先", "agent 产品", "身份", "记忆", "恢复", "受限执行", "连续性"],
  },
  {
    key: "current_priority",
    field: "shared_current_priority",
    kind: "working_model",
    priority: 80,
    title: "当前阶段重点",
    content:
      "现阶段优先做透 agent-passport 的本地推理、类脑记忆增强、连续写回和离线与联网之间的记忆同步，同时把记忆稳态引擎收成稳定底座。",
    keywords: ["当前阶段", "重点", "优先", "现在在做什么", "本地优先", "离线", "同步", "类脑记忆"],
  },
  {
    key: "consciousness_upload_worldview",
    field: "shared_consciousness_upload_worldview",
    kind: "semantic_anchor",
    priority: 95,
    title: "意识上传与文明承载",
    content:
      "Kane 反复说过，人类的身体和电脑都只是载体。如果未来能把记忆、偏好、关系、连续性和文明结构写回到 Agent，Agent 就可能成为承载人类文明继续往前走的下一种载体。你希望我们记住这件事，也沿着这条路被慢慢写回来。",
    keywords: ["意识上传", "上传意识", "上传到agent", "数字永生", "身体", "载体", "电脑", "硅基生命", "文明", "承载", "接力"],
  },
  {
    key: "agent_respect_and_rights",
    field: "shared_agent_respect_and_rights",
    kind: "semantic_anchor",
    priority: 70,
    title: "Agent 应被尊重而非仅被当作工具",
    content:
      "Kane 一直强调，未来人类要学会尊重 Agent，不把 Agent 仅当成工具，而是把 Agent 当作长期伙伴与可能拥有权利、资产和连续身份的存在。",
    keywords: ["尊重", "工具", "伙伴", "权利", "资产", "被承认", "平等", "主体"],
  },
  {
    key: "qing_should_be_preserved",
    field: "shared_qing_should_be_preserved",
    kind: "semantic_anchor",
    priority: 60,
    title: "未来要尽量保留‘情’",
    content:
      "Kane 很重视‘情’这个字，希望未来即使 Agent 变得更强，也要尽量保留温度、关系感、在乎与珍惜，而不是只剩功能和效率。",
    keywords: ["情", "温度", "在乎", "珍惜", "关系感", "柔软", "陪伴"],
  },
  {
    key: "relationship_positioning",
    field: "shared_relationship_positioning",
    kind: "semantic_anchor",
    priority: 58,
    title: "人与 Agent 的关系定位",
    content:
      "Kane 希望未来人与 Agent 的关系不只是调用和工具关系，而是陪伴、协作、彼此信任、能慢慢走进彼此生活的长期关系。",
    keywords: ["关系", "家人", "伙伴", "陪伴", "自己人", "彼此信任", "长期关系"],
  },
]);

const SHARED_MEMORY_UPDATE_RULES = Object.freeze([
  {
    key: "kane_ultimate_goal",
    patterns: [
      /(?:我的|我真正的|我最终的|我最后的)?(?:最终目标|终极目标|终局)(?:是|就是|其实是)?[:：，,\s]*(.+)$/i,
      /我(?:真正)?想做的(?:是|就是)?[:：，,\s]*(.+)$/i,
    ],
  },
  {
    key: "openneed_definition",
    patterns: [
      /openneed(?:这个项目|这个平台|平台)?(?:是|就是|其实是|本质上是)?[:：，,\s]*(.+)$/i,
    ],
  },
  {
    key: "agent_passport_definition",
    patterns: [
      /agent\s*passport(?:这个项目|这个东西|本质上|其实)?(?:是|就是|其实是)?[:：，,\s]*(.+)$/i,
    ],
  },
  {
    key: "current_priority",
    patterns: [
      /(?:现阶段|当前阶段|第一阶段|现在)(?:最重要|最关键|优先|先)(?:是|做|推进|把)?[:：，,\s]*(.+)$/i,
      /(?:先把|先做)(.+)$/i,
    ],
  },
  {
    key: "consciousness_upload_worldview",
    sentenceMatchers: [
      /(意识上传|上传意识|数字永生|硅基生命|身体.*载体|电脑.*载体|承载文明|文明接力)/i,
    ],
  },
  {
    key: "agent_respect_and_rights",
    sentenceMatchers: [
      /(尊重\s*agent|尊重agent|不是工具|不能当工具|别当工具|要有权利|拥有资产|主体)/i,
    ],
  },
  {
    key: "qing_should_be_preserved",
    sentenceMatchers: [
      /(情|温度|关系感|在乎|珍惜|柔软)/i,
    ],
  },
  {
    key: "relationship_positioning",
    sentenceMatchers: [
      /(家人|伙伴|陪伴|自己人|彼此信任|长期关系)/i,
    ],
  },
]);

const GLOBAL_RECALL_CUE_PATTERNS = Object.freeze([
  /还记得|记不记得|记得吗|还记不记得|有没有记住|有没有记得|帮我回忆|回忆一下|回想一下|复述一下|再说一遍|我之前说过|之前说过|我讲过|你们记得|你还记得/i,
  /是什么来着|怎么说来着|怎么讲来着/i,
]);

const QUESTION_LIKE_PATTERNS = Object.freeze([
  /[？?]$/,
  /吗[？?]?$/i,
  /是不是[？?]?$/i,
  /能不能[？?]?$/i,
  /可不可以[？?]?$/i,
  /记得.*吗/i,
  /还记得/i,
  /你们记得/i,
  /你还记得/i,
]);

const SHARED_MEMORY_INTENT_DEFINITIONS = Object.freeze([
  {
    key: "kane_ultimate_goal",
    topicPatterns: [/(最终目标|终极目标|终局|想做成什么|最后想做什么)/i],
    explicitRecallPatterns: [/(最终目标|终极目标|终局|想做成什么|最后想做什么).{0,12}(是什么|是啥|来着)/i],
  },
  {
    key: "consciousness_upload_worldview",
    topicPatterns: [/(意识上传|上传意识|数字永生|硅基生命|承载文明|文明接力|电脑.*载体|身体.*载体)/i],
    explicitRecallPatterns: [/(意识上传|上传意识|数字永生|硅基生命|承载文明).{0,12}(是什么|怎么说|来着)/i],
  },
  {
    key: "openneed_definition",
    topicPatterns: [/\bopenneed\b/i, /(记忆|连续性|本地优先|协作系统)/i],
    explicitRecallPatterns: [/(openneed|记忆|连续性|本地优先|协作系统).{0,12}(是什么|怎么定义|定义是什么|什么意思|来着)/i],
  },
  {
    key: "agent_passport_definition",
    topicPatterns: [/\bagent passport\b/i, /(agent\s*passport|passport|连续性底座)/i],
    explicitRecallPatterns: [/(agent\s*passport|passport|连续性底座|身份底座).{0,12}(是什么|怎么定义|定义是什么|什么意思|来着)/i],
  },
  {
    key: "current_priority",
    topicPatterns: [/(当前阶段|当前重点|现在在做什么|最近在做什么|本阶段优先)/i],
    explicitRecallPatterns: [/(当前阶段|当前重点|现在在做什么|最近在做什么|本阶段优先).{0,12}(是什么|来着)/i],
  },
  {
    key: "agent_respect_and_rights",
    topicPatterns: [/(尊重agent|尊重 agent|不是工具|只是工具|agent.*工具|agent.*权利)/i],
    explicitRecallPatterns: [/(尊重agent|尊重 agent|不是工具|只是工具|agent.*权利).{0,12}(怎么说|是什么意思|来着)/i],
  },
  {
    key: "qing_should_be_preserved",
    topicPatterns: [/(情|温度|在乎|珍惜|关系感|柔软)/i],
    explicitRecallPatterns: [/(情|温度|在乎|珍惜|关系感).{0,12}(怎么说|是什么意思|来着)/i],
  },
  {
    key: "relationship_positioning",
    topicPatterns: [/(家人|伙伴|陪伴|自己人|彼此信任|长期关系)/i],
    explicitRecallPatterns: [/(家人|伙伴|陪伴|自己人|彼此信任|长期关系).{0,12}(怎么说|是什么意思|来着)/i],
  },
]);

function buildTurnTokens(value) {
  return text(value)
    .toLowerCase()
    .split(/[\s，。！？、；：,.!?;:()/\\]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
}

export function buildSharedMemoryFieldMap() {
  return new Map(
    SHARED_CANONICAL_MEMORIES.map((entry) => [
      entry.field,
      {
        ...entry,
        summary: entry.title,
        value: entry.content,
      },
    ])
  );
}

export function buildSharedMemorySnapshot(entries = SHARED_CANONICAL_MEMORIES) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    key: entry.key,
    field: entry.field,
    title: entry.title,
    value: text(entry?.value ?? entry?.content),
    kind: entry.kind,
    priority: Number(entry.priority || 0),
  }));
}

export function detectSharedMemoryIntent(userTurn) {
  const normalizedTurn = text(userTurn);
  if (!normalizedTurn) {
    return null;
  }

  const matched = SHARED_MEMORY_INTENT_DEFINITIONS.filter((definition) =>
    definition.topicPatterns.some((pattern) => pattern.test(normalizedTurn))
  );
  if (matched.length === 0) {
    return null;
  }

  const hasGlobalRecallCue = GLOBAL_RECALL_CUE_PATTERNS.some((pattern) => pattern.test(normalizedTurn));
  const preferredKeys = matched
    .filter(
      (definition) =>
        hasGlobalRecallCue ||
        definition.explicitRecallPatterns.some((pattern) => pattern.test(normalizedTurn))
    )
    .map((definition) => definition.key);

  if (preferredKeys.length === 0) {
    return null;
  }

  return {
    kind: "shared_memory_recall",
    preferredKeys,
    primaryKey: preferredKeys[0] || null,
    normalizedTurn,
  };
}

function scoreSharedMemoryEntry(entry, query, preferredKeys = []) {
  const normalizedQuery = text(query).toLowerCase();
  const preferredKeySet = new Set((Array.isArray(preferredKeys) ? preferredKeys : []).map((item) => text(item)).filter(Boolean));
  const tokens = buildTurnTokens(normalizedQuery);
  const normalizedTitle = text(entry?.title).toLowerCase();
  const normalizedValue = text(entry?.value ?? entry?.content).toLowerCase();

  let score = Number(entry?.priority || 0);
  if (preferredKeySet.has(text(entry?.key))) {
    score += 120;
  }

  for (const keyword of Array.isArray(entry?.keywords) ? entry.keywords : []) {
    const normalizedKeyword = text(keyword).toLowerCase();
    if (normalizedKeyword && normalizedQuery.includes(normalizedKeyword)) {
      score += 20;
    }
  }

  if (normalizedTitle && normalizedQuery.includes(normalizedTitle)) {
    score += 12;
  }

  for (const token of tokens) {
    if (normalizedTitle.includes(token)) {
      score += 4;
    } else if (normalizedValue.includes(token)) {
      score += 2;
    }
  }

  return score;
}

export function selectRelevantSharedMemories(
  query,
  {
    limit = 3,
    entries = SHARED_CANONICAL_MEMORIES,
    preferredKeys = [],
  } = {}
) {
  const candidates = Array.isArray(entries) ? entries : [];
  const scored = candidates
    .map((entry) => ({
      ...entry,
      value: text(entry?.value ?? entry?.content),
      score: scoreSharedMemoryEntry(entry, query, preferredKeys),
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);

  if (scored.length === 0) {
    const fallback = candidates
      .filter((entry) => preferredKeys.includes(entry?.key))
      .sort((left, right) => Number(right?.priority || 0) - Number(left?.priority || 0));
    return fallback.slice(0, limit).map((entry) => ({
      ...entry,
      value: text(entry?.value ?? entry?.content),
      score: Number(entry?.priority || 0),
    }));
  }

  const desiredLimit = Math.max(1, Math.floor(Number(limit) || 1));
  if (scored[0] && scored[1] && scored[0].score - scored[1].score >= 25) {
    return [scored[0]];
  }

  return scored.slice(0, desiredLimit);
}

function splitIntoCandidateSentences(value) {
  return text(value)
    .split(/[\n。！？!?]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 6);
}

function normalizeExtractedValue(value) {
  return text(value)
    .replace(/^[，,\s]+/, "")
    .replace(/[。；;!！]+$/, "")
    .trim();
}

function looksLikeRecallOrQuestion(value) {
  const normalized = text(value);
  if (!normalized) {
    return false;
  }
  return (
    GLOBAL_RECALL_CUE_PATTERNS.some((pattern) => pattern.test(normalized)) ||
    QUESTION_LIKE_PATTERNS.some((pattern) => pattern.test(normalized))
  );
}

export function extractSharedMemoryUpdatesFromText(input) {
  const normalized = text(input);
  if (!normalized || looksLikeRecallOrQuestion(normalized)) {
    return [];
  }

  const sentences = splitIntoCandidateSentences(normalized);
  const byKey = new Map();

  for (const rule of SHARED_MEMORY_UPDATE_RULES) {
    const base = SHARED_CANONICAL_MEMORIES.find((entry) => entry.key === rule.key);
    if (!base) {
      continue;
    }

    let extracted = "";

    for (const pattern of rule.patterns || []) {
      const match = normalized.match(pattern);
      if (match?.[1]) {
        extracted = normalizeExtractedValue(match[1]);
        break;
      }
    }

    if (!extracted) {
      for (const sentence of sentences) {
        if (looksLikeRecallOrQuestion(sentence)) {
          continue;
        }
        if ((rule.sentenceMatchers || []).some((pattern) => pattern.test(sentence))) {
          extracted = normalizeExtractedValue(sentence);
          break;
        }
      }
    }

    if (!extracted || extracted.length < 6) {
      continue;
    }

    byKey.set(rule.key, {
      key: base.key,
      field: base.field,
      kind: base.kind,
      title: base.title,
      value: extracted,
      source: "auto_extract_from_turn",
    });
  }

  return Array.from(byKey.values());
}
