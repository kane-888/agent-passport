import {
  normalizeOptionalText,
} from "./ledger-core-utils.js";

const DEFAULT_RESPONSE_STRONG_CERTAINTY_PATTERNS = [
  /一定/gu,
  /肯定/gu,
  /绝对/gu,
  /毫无疑问/gu,
  /已经证明/gu,
  /已证实/gu,
  /确认无误/gu,
  /confirmed/giu,
  /proven/giu,
  /definitely/giu,
  /certainly/giu,
  /without doubt/giu,
];

const DEFAULT_RESPONSE_HEDGED_CERTAINTY_PATTERNS = [
  /可能/gu,
  /也许/gu,
  /大概/gu,
  /倾向于/gu,
  /推测/gu,
  /疑似/gu,
  /估计/gu,
  /似乎/gu,
  /may/giu,
  /might/giu,
  /likely/giu,
  /suggests?/giu,
  /appears?/giu,
];

export function collectResponseCertaintyHits(responseText = "", patterns = []) {
  const text = normalizeOptionalText(responseText) ?? "";
  if (!text) {
    return [];
  }
  const hits = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern) ?? [];
    for (const match of matches) {
      const normalized = normalizeOptionalText(match) ?? null;
      if (normalized && !hits.includes(normalized)) {
        hits.push(normalized);
      }
    }
  }
  return hits;
}

export function buildResponseCertaintySignal(responseText = "") {
  const strongHits = collectResponseCertaintyHits(responseText, DEFAULT_RESPONSE_STRONG_CERTAINTY_PATTERNS);
  const hedgedHits = collectResponseCertaintyHits(responseText, DEFAULT_RESPONSE_HEDGED_CERTAINTY_PATTERNS);
  return {
    strongHits,
    hedgedHits,
    hasStrong: strongHits.length > 0,
    hasHedged: hedgedHits.length > 0,
  };
}
