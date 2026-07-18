import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

export type RotateApply = (angle: number, anchor: number[]) => void;
export type ScaleApply = (factor: number, anchor: number[]) => void;
export type MirrorApply = (a: number[], b: number[]) => void;
export type CancelApply = () => void;

type BridgeHandler =
  | { kind: 'rotate'; apply: RotateApply; cancel: CancelApply }
  | { kind: 'scale'; apply: ScaleApply; cancel: CancelApply }
  | { kind: 'mirror'; apply: MirrorApply; cancel: CancelApply }
  | null;

type TransformBridgeState = {
  handler: BridgeHandler;
  setHandler: (h: BridgeHandler) => void;
  getHandler: () => BridgeHandler;
};

export const useTransformBridge = create<TransformBridgeState>()(
  immer((set, get) => ({
    handler: null,
    setHandler: (h) =>
      set((s) => {
        s.handler = h;
      }),
    getHandler: () => get().handler,
  })),
);
