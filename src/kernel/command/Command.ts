// src/commands/core/Command.ts
//
// `CommandContext` vive en `./commandContext` y `getCommandContext` se
// importa desde ahí directamente en `CommandStack.ts`. Este archivo solo
// re-exporta el tipo para preservar el contrato de los consumidores que
// importan `CommandContext` desde `./Command`.
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
