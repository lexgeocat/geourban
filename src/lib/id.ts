export function createIdFactory(defaultPrefix = 'id') {
  let counter = 0;
  return (prefix: string = defaultPrefix): string => {
    counter += 1;
    return `${prefix}-${Date.now()}-${counter.toString(36)}`;
  };
}

export const nextId = createIdFactory();
