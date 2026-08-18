let collator: Intl.Collator | null = null;
function getCollator(): Intl.Collator {
  if (!collator) collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return collator;
}
export function naturalCompare(a: string, b: string): number {
  return getCollator().compare(a, b);
}
