function createIdFactory(defaultPrefix = 'id') {
  let counter = 0;
  return (prefix: string = defaultPrefix): string => {
    counter += 1;
    return `${prefix}-${Date.now()}-${counter.toString(36)}`;
  };
}

export const nextId = createIdFactory();

export function newId(prefix?: string): string {
  let unique: string;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    unique = crypto.randomUUID();
  } else {
    unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return prefix ? `${prefix}-${unique}` : unique;
}

