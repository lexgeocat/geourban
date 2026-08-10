export type Provider<T> = () => T;
export type EntityGeometryProvider = (id: string | number, resolution: number) => number[][] | null;
export interface ExtensionPoint<T> {
  register: (key: string, provider: Provider<T>) => void;
  unregister: (key: string) => void;
  has: (key: string) => boolean;
  collect: () => T[];
  get: (key: string) => Provider<T> | undefined;
}

export interface DirectExtensionPoint<T> {
  register: (key: string, value: T) => void;
  unregister: (key: string) => void;
  has: (key: string) => boolean;
  collect: () => T[];
  get: (key: string) => T | undefined;
}

export function createExtensionPoint<T>(): ExtensionPoint<T> {
  const providers = new Map<string, Provider<T>>();
  return {
    register(key, provider) {
      providers.set(key, provider);
    },
    unregister(key) {
      providers.delete(key);
    },
    has(key) {
      return providers.has(key);
    },
    collect() {
      return Array.from(providers.values()).map((p) => p());
    },
    get(key) {
      return providers.get(key);
    },
  };
}

export function createDirectExtensionPoint<T>(): DirectExtensionPoint<T> {
  const values = new Map<string, T>();
  return {
    register(key, value) {
      values.set(key, value);
    },
    unregister(key) {
      values.delete(key);
    },
    has(key) {
      return values.has(key);
    },
    collect() {
      return Array.from(values.values());
    },
    get(key) {
      return values.get(key);
    },
  };
}
