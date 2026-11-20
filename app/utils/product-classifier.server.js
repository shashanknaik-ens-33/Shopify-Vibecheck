// Product → try-on category detection.
// Moved out of app._index.jsx. The matching rules are unchanged.

const normalize = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const RULES = [
  {
    category: "Lipstick",
    effectReady: false,
    pattern:
      /\b(lipsticks?|lip gloss(?:es)?|lipgloss(?:es)?|lip tints?|lip stains?|lip colors?|lip colours?)\b/,
  },
  {
    category: "Headbands",
    effectReady: false,
    pattern: /\b(headbands?|hair bands?|alice bands?|head wraps?)\b/,
  },
  {
    category: "Glasses",
    effectReady: true,
    pattern:
      /\b(glasses|eyeglasses|sunglasses|spectacles|eyewear|optical frames?|reading glasses)\b/,
  },
  {
    category: "Clothing",
    effectReady: false,
    pattern:
      /\b(t shirts?|tshirts?|tees|shirts?|tops|blouses|dresses|hoodies|sweatshirts|jackets|coats|sweaters|jeans|trousers|pants|shorts|skirts|leggings|jumpsuits|rompers|cardigans)\b/,
  },
];

export function classifyProduct(product) {
  const title = normalize(product.title);
  const productType = normalize(product.productType);
  const tags = (product.tags ?? []).map(normalize);
  const searchableText = [title, productType, ...tags].join(" ");

  // First matching rule wins (same order as before).
  const match = RULES.find((rule) => rule.pattern.test(searchableText));

  return match
    ? { category: match.category, effectReady: match.effectReady }
    : { category: "Unsupported", effectReady: false };
}