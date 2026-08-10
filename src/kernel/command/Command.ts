import type { CommandContext } from './commandContext';
export type { CommandContext };

export abstract class Command {
  abstract readonly label: string;
  readonly coalesceKey?: string;
  abstract execute(ctx: CommandContext): void | Promise<void>;
  undo?(ctx: CommandContext): void | Promise<void>;
  redo?(ctx: CommandContext): void | Promise<void>;
  coalesceInto?(previous: Command): boolean;
  approxMemoryBytes(): number {
    return 256;
  }
}
