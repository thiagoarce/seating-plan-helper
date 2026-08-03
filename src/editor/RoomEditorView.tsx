/**
 * Room editor screen: wires the store to the canvas, palette, and property
 * panel (PRODUCT_SPEC §5.2).
 */

import { useMemo } from 'react';
import type { Rect } from '../domain/types';
import { useMessages } from '../i18n/useMessages';
import type { Store } from '../app/store';
import { buildSeatPresentations } from '../shared/RoomGraphics';
import { DEFAULT_ROOM_VIEW_OPTIONS } from '../shared/RoomGraphics';
import { applyMove, applyResize, RoomCanvas } from './RoomCanvas';
import { EditorToolsPanel, PropertiesPanel } from './EditorPanels';

export interface RoomEditorViewProps {
  project: NonNullable<Store['project']>;
  selection: string[];
  viewport: Store['viewport'];
  onSelectionChange: (keys: string[]) => void;
  onViewportChange: (viewport: Partial<Store['viewport']>) => void;
  updateRoom: Store['updateRoom'];
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export function RoomEditorView(props: RoomEditorViewProps): JSX.Element {
  const { t } = useMessages();
  const { project } = props;

  const seats = useMemo(
    () => buildSeatPresentations(project.room, new Map(), new Map()),
    [project.room],
  );

  const options = useMemo(
    () => ({ ...DEFAULT_ROOM_VIEW_OPTIONS, showRegions: true }),
    [],
  );

  return (
    <div className="workspace">
      <EditorToolsPanel project={project} onUpdateRoom={props.updateRoom} />

      <section className="panel canvas-panel">
        <div className="canvas-toolbar">
          <button type="button" onClick={props.undo} disabled={!props.canUndo}>
            {t('editor.undo')}
          </button>
          <button type="button" onClick={props.redo} disabled={!props.canRedo}>
            {t('editor.redo')}
          </button>
          <div className="separator" />
          <button
            type="button"
            onClick={() => props.onViewportChange({ zoom: props.viewport.zoom * 1.2 })}
          >
            {t('editor.zoomIn')}
          </button>
          <button
            type="button"
            onClick={() => props.onViewportChange({ zoom: props.viewport.zoom / 1.2 })}
          >
            {t('editor.zoomOut')}
          </button>
        </div>

        <RoomCanvas
          room={project.room}
          seats={seats}
          options={options}
          mode="edit"
          selection={props.selection}
          viewport={props.viewport}
          onViewportChange={props.onViewportChange}
          onSelectionChange={props.onSelectionChange}
          onMoveItems={(keys, dx, dy) => props.updateRoom((room) => applyMove(room, keys, dx, dy))}
          onResizeItem={(key, bounds: Rect) =>
            props.updateRoom((room) => applyResize(room, key, bounds))
          }
        />
      </section>

      <PropertiesPanel
        project={project}
        selection={props.selection}
        onUpdateRoom={props.updateRoom}
        onSelectionChange={props.onSelectionChange}
      />
    </div>
  );
}
