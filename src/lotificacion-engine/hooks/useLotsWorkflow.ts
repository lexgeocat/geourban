import { useManzanoStore } from '../store/entities/manzanoStore';
import { useMapStore } from '../store/map/mapStore';
import { useCommandStack } from '../commands/core/CommandStack';
import { GenerateLotsCommand } from '../commands/lots/GenerateLotsCommand';
import { useGenerateLotsProgressStore } from '../store/ui/generateLotsProgressStore';
import { useSubdivisionPreviewStore } from '../store/ui/subdivisionPreviewStore';
import { useLeftSidebarStore } from '../store/ui/leftSidebarStore';
import { getFeatureKind } from '../core/objectModel';
import { requireLayerForKind } from '../store/ui/layerPickerStore';
import { toast } from '../store/ui/toastStore';

export const MANZANO_FOCUS_EVENT = 'geourban:focus-manzano';

export interface ManzanoFocusEventDetail {
  id: string | number;
}

export function useLotsWorkflow() {
  const targetAreaM2 = useManzanoStore((s) => s.targetAreaM2);
  const frontMinM = useManzanoStore((s) => s.frontMinM);
  const lotsBusy = useGenerateLotsProgressStore((s) => s.active);

  const runGenerateAllLots = async (): Promise<void> => {
    if (lotsBusy) return;
    const src = useMapStore.getState().drawSource;
    if (!src) return;

    let manzanoCount = 0;
    src.forEachFeature((f) => {
      if (getFeatureKind(f) === 'manzana') manzanoCount++;
    });
    if (manzanoCount === 0) {
      toast('No hay manzanos para subdividir. Trazá calles primero para generar manzanos.', {
        variant: 'warning',
      });
      return;
    }

    const layerId = await requireLayerForKind('lote');
    if (!layerId) return;

    useSubdivisionPreviewStore.getState().clear();

    try {
      const result = await useCommandStack
        .getState()
        .run(new GenerateLotsCommand({ targetAreaM2, frontMinM, layerId }));

      if (!result.ok) {
        toast(result.error, { variant: 'error', durationMs: 6000 });
        return;
      }

      let newLotes = 0;
      src.forEachFeature((f) => {
        const k = getFeatureKind(f);
        if (k === 'lote' || (typeof f.get('label') === 'string' && f.get('label')?.toString().startsWith('Lote'))) {
          newLotes++;
        }
      });
      if (newLotes > 0) {
        toast(`${newLotes} lotes generados automáticamente.`, { variant: 'success' });
      } else {
        toast('No se pudieron generar lotes. Verificá que los manzanos sean lo suficientemente grandes.', {
          variant: 'warning',
        });
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Error al generar lotes', {
        variant: 'error',
        durationMs: 6000,
      });
    }
  };

  const cancelGenerateAllLots = (): void => {
    useGenerateLotsProgressStore.getState().requestCancel();
  };

  const focusManzanoInSidebar = (featureId: string | number): void => {
    useLeftSidebarStore.getState().openTab('manzanos');
    useManzanoStore.getState().setCardOpen(featureId, true);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<ManzanoFocusEventDetail>(MANZANO_FOCUS_EVENT, { detail: { id: featureId } }),
      );
    }
  };

  return {
    lotsBusy,
    runGenerateAllLots,
    cancelGenerateAllLots,
    focusManzanoInSidebar,
  };
}