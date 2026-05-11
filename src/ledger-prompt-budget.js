import {
  normalizeOptionalText,
  toFiniteNumber,
} from "./ledger-core-utils.js";
import {
  DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT,
} from "./ledger-runtime-memory-homeostasis.js";

export const DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT = 16000;

export function stringifyPromptSection(value) {
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

export function estimatePromptTokens(value) {
  const text = stringifyPromptSection(value);
  if (!text) {
    return 0;
  }

  const cjkMatches = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu) ?? [];
  const cjkCount = cjkMatches.length;
  const asciiText = text.replace(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu, "");
  const wordMatches = asciiText.match(/[A-Za-z0-9_]+/g) ?? [];
  const wordChars = wordMatches.reduce((sum, item) => sum + item.length, 0);
  const whitespaceChars = (asciiText.match(/\s+/g) ?? []).reduce((sum, item) => sum + item.length, 0);
  const remainderChars = Math.max(0, asciiText.length - wordChars - whitespaceChars);
  return Math.max(1, cjkCount + Math.ceil(wordChars / 4) + Math.ceil(remainderChars / 2));
}

export function truncatePromptTextByTokenBudget(text, maxTokens) {
  const normalizedText = stringifyPromptSection(text);
  if (!normalizedText || estimatePromptTokens(normalizedText) <= maxTokens) {
    return normalizedText;
  }

  const suffix = "\n...<truncated>";
  let low = 0;
  let high = normalizedText.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = `${normalizedText.slice(0, Math.max(0, mid - suffix.length))}${suffix}`;
    if (estimatePromptTokens(candidate) <= maxTokens) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return `${normalizedText.slice(0, Math.max(0, low - suffix.length))}${suffix}`;
}

export function truncatePromptSection(value, { maxChars = null, maxTokens = null } = {}) {
  let text = stringifyPromptSection(value);
  if (maxChars != null && text.length > maxChars) {
    text = `${text.slice(0, Math.max(0, maxChars - 24))}\n...<truncated>`;
  }
  if (maxTokens != null) {
    text = truncatePromptTextByTokenBudget(text, maxTokens);
  }
  return text;
}

export function buildBudgetedPromptSections(
  sectionBlueprints = [],
  {
    maxContextTokens = DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT,
    maxContextChars = DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT,
    maxSectionTokens = null,
    maxSectionChars = null,
  } = {}
) {
  const blueprints = Array.isArray(sectionBlueprints) ? sectionBlueprints.filter(Boolean) : [];
  const sections = [];
  const omittedTitles = [];
  let remainingTokens = Math.max(128, Math.floor(toFiniteNumber(maxContextTokens, DEFAULT_RUNTIME_CONTEXT_TOKEN_LIMIT) * 0.92));
  let remainingChars = Math.max(640, Math.floor(toFiniteNumber(maxContextChars, DEFAULT_RUNTIME_CONTEXT_CHAR_LIMIT) * 0.92));

  for (let index = 0; index < blueprints.length; index += 1) {
    const blueprint = blueprints[index];
    const remainingSectionCount = Math.max(1, blueprints.length - index);
    const priority = normalizeOptionalText(blueprint.priority)?.toLowerCase() ?? "medium";
    const minTokens =
      Number.isFinite(Number(blueprint.minTokens))
        ? Math.max(16, Math.floor(Number(blueprint.minTokens)))
        : priority === "high"
          ? 72
          : priority === "low"
            ? 24
            : 40;
    const minChars =
      Number.isFinite(Number(blueprint.minChars))
        ? Math.max(80, Math.floor(Number(blueprint.minChars)))
        : priority === "high"
          ? 320
          : priority === "low"
            ? 120
            : 180;

    if (priority === "low" && remainingTokens < Math.max(24, Math.floor(minTokens / 2))) {
      omittedTitles.push(blueprint.title);
      continue;
    }

    let sectionTokenBudget = Math.max(minTokens, Math.floor(remainingTokens / remainingSectionCount));
    if (maxSectionTokens != null) {
      sectionTokenBudget = Math.min(sectionTokenBudget, maxSectionTokens);
    }

    let sectionCharBudget = Math.max(minChars, Math.floor(remainingChars / remainingSectionCount));
    if (maxSectionChars != null) {
      sectionCharBudget = Math.min(sectionCharBudget, maxSectionChars);
    }

    let text = truncatePromptSection(blueprint.value, {
      maxChars: sectionCharBudget,
      maxTokens: sectionTokenBudget,
    });

    if (!normalizeOptionalText(text)) {
      omittedTitles.push(blueprint.title);
      continue;
    }

    let estimatedTokens = estimatePromptTokens(`${blueprint.title}\n${text}`);
    if (estimatedTokens > remainingTokens && remainingTokens > 48) {
      text = truncatePromptSection(blueprint.value, {
        maxChars: Math.max(96, Math.floor(sectionCharBudget * 0.75)),
        maxTokens: Math.max(24, remainingTokens - 12),
      });
      estimatedTokens = estimatePromptTokens(`${blueprint.title}\n${text}`);
    }

    if (estimatedTokens > remainingTokens && priority === "low") {
      omittedTitles.push(blueprint.title);
      continue;
    }

    sections.push({
      title: blueprint.title,
      text,
      priority,
      estimatedTokens,
    });
    remainingTokens = Math.max(0, remainingTokens - estimatedTokens);
    remainingChars = Math.max(0, remainingChars - text.length);
  }

  let compiledPrompt = sections.flatMap((section) => [section.title, section.text, ""]).join("\n");
  while (sections.length > 1 && estimatePromptTokens(compiledPrompt) > maxContextTokens) {
    let removableIndex = -1;
    for (let index = sections.length - 1; index >= 0; index -= 1) {
      if (sections[index].priority !== "high") {
        removableIndex = index;
        break;
      }
    }
    if (removableIndex === -1) {
      removableIndex = sections.length - 1;
    }
    omittedTitles.push(sections[removableIndex].title);
    sections.splice(removableIndex, 1);
    compiledPrompt = sections.flatMap((section) => [section.title, section.text, ""]).join("\n");
  }

  return {
    sections,
    omittedTitles,
    compiledPrompt,
    estimatedContextTokens: estimatePromptTokens(compiledPrompt),
  };
}
