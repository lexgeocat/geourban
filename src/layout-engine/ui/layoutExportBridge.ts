interface LayoutExportHandlers {
  exportPng: () => void;
  printPdf: () => void;
  openDxfPicker: () => void;
  stepLot: (delta: number) => void;
}

let activeHandlers: LayoutExportHandlers | null = null;

export function registerLayoutExportHandlers(handlers: LayoutExportHandlers | null): void {
  activeHandlers = handlers;
}

export function triggerLayoutExportPng(): void {
  activeHandlers?.exportPng();
}

export function triggerLayoutPrintPdf(): void {
  activeHandlers?.printPdf();
}

export function triggerLayoutDxfImport(): void {
  activeHandlers?.openDxfPicker();
}

export function triggerLayoutStepLot(delta: number): void {
  activeHandlers?.stepLot(delta);
}
