import { create } from 'zustand';

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
