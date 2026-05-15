import { normalizeComparableText } from "./ledger-core-utils.js";

function buildCharacterSet(value) {
  return new Set([...normalizeComparableText(value)]);
}

export function compareTextSimilarity(left, right) {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  if (normalizedLeft === normalizedRight) {
    return 1;
  }

  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
    const shorter = Math.min(normalizedLeft.length, normalizedRight.length);
    const longer = Math.max(normalizedLeft.length, normalizedRight.length);
    return longer > 0 ? shorter / longer : 0;
  }

  const leftSet = buildCharacterSet(normalizedLeft);
  const rightSet = buildCharacterSet(normalizedRight);
  const intersection = [...leftSet].filter((item) => rightSet.has(item)).length;
  const union = new Set([...leftSet, ...rightSet]).size;
  return union > 0 ? intersection / union : 0;
}
