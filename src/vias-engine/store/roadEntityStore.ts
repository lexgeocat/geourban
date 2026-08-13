import { autoName } from '@kernel/id/autoName';

export function createIdCounter(): {
  next: (prefix: string) => string;
  reset: () => void;
} {
  let n = 1;
  return {
    next: (prefix: string) => `${prefix}${n++}`,
    reset: () => {
      n = 1;
    },
  };
}

export function nextEntityName(count: number, prefix: string): string {
  return autoName(count, prefix);
}

export function renumberEntityNames<T extends { name: string }>(
  entities: T[],
  prefix: string
): void {
  entities.forEach((e, i) => {
    e.name = autoName(i, prefix);
  });
}
