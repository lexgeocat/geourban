import { invoke } from '@tauri-apps/api/core';

export interface NativeMemorySnapshot {
  rssMB: number;
  privateMB: number;
  peakRssMB: number;
  available: boolean;
  lastUpdatedMs: number;
}

const memory: NativeMemorySnapshot = {
  rssMB: 0,
  privateMB: 0,
  peakRssMB: 0,
  available: false,
  lastUpdatedMs: 0,
};

const REFRESH_MS = 2000;

export function _resetNativeMemoryForTests(): void {
  memory.rssMB = 0;
  memory.privateMB = 0;
  memory.peakRssMB = 0;
  memory.available = false;
  memory.lastUpdatedMs = 0;
}

export async function refreshNativeMemory(force = false): Promise<NativeMemorySnapshot> {
  if (!force && Date.now() - memory.lastUpdatedMs < REFRESH_MS) return memory;
  try {
    const res = await invoke<{ rssBytes: number; privateBytes: number; peakRssBytes: number } | null>(
      'process_memory',
    );
    if (res) {
      const MB = 1024 * 1024;
      memory.rssMB = res.rssBytes / MB;
      memory.privateMB = res.privateBytes / MB;
      memory.peakRssMB = res.peakRssBytes / MB;
      memory.available = true;
    } else {
      memory.available = false;
    }
  } catch {
    memory.available = false;
  }
  memory.lastUpdatedMs = Date.now();
  return memory;
}

export function readNativeMemorySnapshot(): NativeMemorySnapshot {
  return { ...memory };
}
