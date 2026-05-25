// Quantity parsing helpers used by the meal batch UI when scaling AI-suggested
// ingredient amounts (e.g., user bumps "2 lb" → "2.5 lb" before prepping).

export function parseQty(qty: string): { num: number; unit: string } | null {
  const s = qty.trim();
  // "1 3/4 cup" — mixed number
  const mixed = s.match(/^(\d+)\s+(\d+)\/(\d+)\s*(.*)$/);
  if (mixed) return { num: parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3]), unit: mixed[4].trim().toLowerCase() };
  // "3/4 cup" — simple fraction
  const frac = s.match(/^(\d+)\/(\d+)\s*(.*)$/);
  if (frac) return { num: parseInt(frac[1]) / parseInt(frac[2]), unit: frac[3].trim().toLowerCase() };
  // "1.5 tbsp" or "3 large"
  const plain = s.match(/^(\d*\.?\d+)\s*(.*)$/);
  if (!plain) return null;
  return { num: parseFloat(plain[1]), unit: plain[2].trim().toLowerCase() };
}

export function scaleIngredients(
  ingredients: { item: string; qty: string }[],
  servings: number,
): { item: string; qty: string }[] {
  return ingredients.map(({ item, qty }) => {
    if (servings === 1) return { item, qty };
    const parsed = parseQty(qty);
    if (!parsed) return { item, qty: `${qty} ×${servings}` };
    const scaled = parsed.num * servings;
    const display = Number.isInteger(scaled) ? String(scaled) : scaled.toFixed(1);
    return { item, qty: `${display}${parsed.unit ? " " + parsed.unit : ""} total` };
  });
}
