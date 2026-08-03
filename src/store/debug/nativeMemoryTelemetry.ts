// src/store/debug/nativeMemoryTelemetry.ts
//
// Fase 6.2 (auditoria-para-mejora.md) — memoria del PROCESO NATIVO (Rust),
// no del heap de JS. `performance.memory` solo ve el heap del webview; el
// proceso Rust (GEOS, buffers batch, índice espacial, SQLite) queda fuera.
// Este módulo cachea la última medición del comando `process_memory` y la
// re-refresca a lo sumo cada REFRESH_MS — el panel de debug la muestra sin
// hacer un `invoke` por frame.

import { invoke } from '@tauri-apps/api/core';

export interface NativeMemorySnapshot {
  /** RSS — memoria física del proceso Rust (MB). */
  rssMB: number;
  /** Bytes privados (MB) — porción no compartida con otros procesos. */
  privateMB: number;
  /** Pico de RSS desde el arranque (MB). */
  peakRssMB: number;
  /** false si la plataforma no expone la vía (comando devolvió null). */
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

/** Solo para tests/depuración. */
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
