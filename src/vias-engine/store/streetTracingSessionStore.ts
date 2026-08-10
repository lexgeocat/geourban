import { create } from 'zustand';

/**
 * Id de sesión del trazo de calle/rotonda en curso. Mientras el usuario está
 * dibujando una calle (entre `drawstart` y `drawend` de la interacción `Draw`),
 * `currentSessionId` permanece estable; cambia al iniciar el siguiente trazo.
 * Se usa como `coalesceKey` en `AddStreetCommand`/`AddRoundaboutCommand` para
 * que dos trazos consecutivos NO se fusionen en un único undo.
 */
interface StreetTracingSessionState {
  currentSessionId: string;
  nextSession(): string;
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `street-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useStreetTracingSessionStore = create<StreetTracingSessionState>()((set) => ({
  currentSessionId: makeSessionId(),
  nextSession: () => {
    const id = makeSessionId();
    set({ currentSessionId: id });
    return id;
  },
}));
