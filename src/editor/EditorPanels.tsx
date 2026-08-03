/**
 * Room editor side panels: the palette of things to add, and numeric property
 * editing for the current selection (TECHNICAL_SPEC §8).
 *
 * Numeric fields exist alongside dragging because dragging alone cannot express
 * "exactly 40 units from the wall", and because they give keyboard users a way
 * to position items precisely.
 */

import { useMemo } from 'react';
import { DEFAULT_GRID_SIZE, SEAT_SIZE } from '../domain/defaults';
import { rotatedBounds } from '../domain/geometry';
import { assignableSeatCount } from '../domain/room';
import type {
  RoomDefinition,
  RoomObjectType,
  SeatingProject,
} from '../domain/types';
import { useMessages } from '../i18n/useMessages';
import { createId } from '../shared/id';
import { NumberField, Panel, SelectField, TextField, Toggle } from '../shared/ui';
import { buildCenter, buildObject, buildRegion, buildTrapezoidFlower } from '../templates/builders';
import { parseSelectionKey } from '../app/selection';
import { applyResize, type RoomCanvasProps } from './RoomCanvas';
import { rotateBy90 } from './canvasMath';

const OBJECT_TYPES: RoomObjectType[] = [
  'board',
  'door',
  'teacherDesk',
  'waterFountain',
  'window',
  'cabinet',
  'custom',
];

const DEFAULT_OBJECT_SIZE: Record<RoomObjectType, { width: number; height: number }> = {
  board: { width: 320, height: 24 },
  door: { width: 24, height: 90 },
  teacherDesk: { width: 140, height: 60 },
  waterFountain: { width: 50, height: 40 },
  window: { width: 200, height: 16 },
  cabinet: { width: 120, height: 45 },
  custom: { width: 100, height: 60 },
};

/** A spot near the middle of the room, nudged so new items do not stack. */
function dropSpot(room: RoomDefinition, size: { width: number; height: number }): {
  x: number;
  y: number;
} {
  const count = room.centers.length + room.objects.length + room.labels.length;
  const offset = (count % 6) * DEFAULT_GRID_SIZE * 2;
  return {
    x: Math.max(0, Math.round((room.width - size.width) / 2 + offset)),
    y: Math.max(0, Math.round((room.height - size.height) / 2 + offset)),
  };
}

export interface EditorToolsPanelProps {
  project: SeatingProject;
  onUpdateRoom: (mutate: (room: RoomDefinition) => void) => void;
}

export function EditorToolsPanel({
  project,
  onUpdateRoom,
}: EditorToolsPanelProps): JSX.Element {
  const { t } = useMessages();
  const room = project.room;

  const addCenter = (seatCount: number): void => {
    onUpdateRoom((draft) => {
      const columns = seatCount <= 2 ? seatCount : Math.ceil(seatCount / 2);
      const id = createId('center');
      // A center added straight from the palette has no template to inherit
      // a name from, so it defaults to "Grupo N"/"Lugar N" — otherwise it
      // would show its raw id everywhere (roster seat tags, the fixed-seat
      // rule picker) until the user manually renamed it.
      const ordinal = draft.centers.length + 1;
      const name =
        seatCount === 1
          ? `${t('editor.defaultName.seat')} ${ordinal}`
          : `${t('editor.defaultName.group')} ${ordinal}`;
      const probe = buildCenter({ id, x: 0, y: 0, seatCount, columns, name });
      const spot = dropSpot(draft, probe);
      draft.centers.push(buildCenter({ id, x: spot.x, y: spot.y, seatCount, columns, name }));
    });
  };

  const addTrapezoidFlower = (): void => {
    onUpdateRoom((draft) => {
      const id = createId('center');
      const ordinal = draft.centers.length + 1;
      const name = `${t('template.namePrefix.flower')} ${ordinal}`;
      const probe = buildTrapezoidFlower({ id, x: 0, y: 0, name });
      const spot = dropSpot(draft, probe);
      draft.centers.push(buildTrapezoidFlower({ id, x: spot.x, y: spot.y, name }));
    });
  };

  const addObject = (type: RoomObjectType): void => {
    onUpdateRoom((draft) => {
      const size = DEFAULT_OBJECT_SIZE[type];
      const spot = dropSpot(draft, size);
      draft.objects.push(
        buildObject(createId('obj'), type, t(`object.${type}`), {
          x: spot.x,
          y: spot.y,
          ...size,
        }),
      );
    });
  };

  return (
    <Panel title={t('editor.title')}>
      <div className="stack" style={{ marginBottom: 'var(--space-4)' }}>
        <button type="button" onClick={() => addCenter(1)}>
          {t('editor.add.seat')}
        </button>
        {[2, 3, 4, 5, 6].map((count) => (
          <button key={count} type="button" onClick={() => addCenter(count)}>
            {t('editor.add.center', { count })}
          </button>
        ))}
        <button type="button" onClick={addTrapezoidFlower}>
          {t('editor.add.trapezoidFlower')}
        </button>
      </div>

      <SelectField
        label={t('editor.add.object')}
        value=""
        onChange={(value) => {
          if (value) addObject(value as RoomObjectType);
        }}
        options={[
          { value: '', label: t('common.none') },
          ...OBJECT_TYPES.map((type) => ({ value: type, label: t(`object.${type}`) })),
        ]}
      />

      <div className="stack" style={{ marginBottom: 'var(--space-4)' }}>
        <button
          type="button"
          onClick={() =>
            onUpdateRoom((draft) => {
              const spot = dropSpot(draft, { width: 300, height: 200 });
              draft.regions.push(
                buildRegion(createId('region'), t('editor.add.region'), {
                  type: 'rectangle',
                  x: spot.x,
                  y: spot.y,
                  width: 300,
                  height: 200,
                }),
              );
            })
          }
        >
          {t('editor.add.region')}
        </button>
        <button
          type="button"
          onClick={() =>
            onUpdateRoom((draft) => {
              const spot = dropSpot(draft, { width: 120, height: 20 });
              draft.labels.push({
                id: createId('label'),
                text: t('editor.add.label'),
                x: spot.x,
                y: spot.y,
                rotation: 0,
                fontSize: 16,
                visibleInExport: true,
              });
            })
          }
        >
          {t('editor.add.label')}
        </button>
      </div>

      <h3 style={{ marginBottom: 'var(--space-2)' }}>{t('editor.room.size')}</h3>
      <div className="field-row">
        <NumberField
          label={t('editor.property.width')}
          value={room.width}
          min={200}
          step={20}
          onChange={(value) =>
            onUpdateRoom((draft) => {
              draft.width = value;
              draft.orientation = draft.width >= draft.height ? 'landscape' : 'portrait';
            })
          }
        />
        <NumberField
          label={t('editor.property.height')}
          value={room.height}
          min={200}
          step={20}
          onChange={(value) =>
            onUpdateRoom((draft) => {
              draft.height = value;
              draft.orientation = draft.width >= draft.height ? 'landscape' : 'portrait';
            })
          }
        />
      </div>

      <Toggle
        label={t('editor.grid.show')}
        checked={room.grid.visible}
        onChange={(value) =>
          onUpdateRoom((draft) => {
            draft.grid.visible = value;
          })
        }
      />
      <Toggle
        label={t('editor.grid.snap')}
        checked={room.grid.snap}
        onChange={(value) =>
          onUpdateRoom((draft) => {
            draft.grid.snap = value;
          })
        }
      />

      <p className="muted">{t('editor.seatCount', { count: assignableSeatCount(room) })}</p>
      <p className="muted">{t('editor.help.multiSelect')}</p>
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

export interface PropertiesPanelProps {
  project: SeatingProject;
  selection: string[];
  onUpdateRoom: (mutate: (room: RoomDefinition) => void) => void;
  onSelectionChange: (keys: string[]) => void;
}

export function PropertiesPanel({
  project,
  selection,
  onUpdateRoom,
  onSelectionChange,
}: PropertiesPanelProps): JSX.Element {
  const { t } = useMessages();
  const room = project.room;

  const single = selection.length === 1 ? parseSelectionKey(selection[0] ?? '') : null;

  const bounds = useMemo(() => {
    if (!single) return null;
    if (single.kind === 'center') {
      const center = room.centers.find((item) => item.id === single.id);
      return center ? rotatedBounds(center, center.rotation) : null;
    }
    if (single.kind === 'object') {
      const object = room.objects.find((item) => item.id === single.id);
      return object ? rotatedBounds(object, object.rotation) : null;
    }
    if (single.kind === 'region') {
      const region = room.regions.find((item) => item.id === single.id);
      return region?.geometry.type === 'rectangle' ? region.geometry : null;
    }
    return null;
  }, [room, single]);

  const remove = (): void => {
    const keys = selection
      .map((key) => parseSelectionKey(key))
      .filter((item): item is { kind: ReturnType<typeof parseSelectionKey> extends null ? never : NonNullable<ReturnType<typeof parseSelectionKey>>['kind']; id: string } => item !== null);

    onUpdateRoom((draft) => {
      for (const item of keys) {
        switch (item.kind) {
          case 'center':
            draft.centers = draft.centers.filter((center) => center.id !== item.id);
            break;
          case 'object':
            draft.objects = draft.objects.filter((object) => object.id !== item.id);
            break;
          case 'region':
            draft.regions = draft.regions.filter((region) => region.id !== item.id);
            break;
          case 'label':
            draft.labels = draft.labels.filter((label) => label.id !== item.id);
            break;
          case 'seat':
            for (const center of draft.centers) {
              center.seats = center.seats.filter((seat) => seat.id !== item.id);
            }
            break;
        }
      }
    });
    onSelectionChange([]);
  };

  const duplicate = (): void => {
    const created: string[] = [];
    onUpdateRoom((draft) => {
      for (const key of selection) {
        const parsed = parseSelectionKey(key);
        if (!parsed) continue;
        const offset = DEFAULT_GRID_SIZE * 2;

        if (parsed.kind === 'center') {
          const source = draft.centers.find((item) => item.id === parsed.id);
          if (!source) continue;
          const id = createId('center');
          draft.centers.push({
            ...structuredClone(source),
            id,
            x: source.x + offset,
            y: source.y + offset,
            seats: source.seats.map((seat) => ({
              ...seat,
              id: createId('seat'),
              centerId: id,
            })),
          });
          created.push(`center:${id}`);
        }
        if (parsed.kind === 'object') {
          const source = draft.objects.find((item) => item.id === parsed.id);
          if (!source) continue;
          const id = createId('obj');
          draft.objects.push({ ...structuredClone(source), id, x: source.x + offset, y: source.y + offset });
          created.push(`object:${id}`);
        }
        if (parsed.kind === 'label') {
          const source = draft.labels.find((item) => item.id === parsed.id);
          if (!source) continue;
          const id = createId('label');
          draft.labels.push({ ...structuredClone(source), id, x: source.x + offset, y: source.y + offset });
          created.push(`label:${id}`);
        }
      }
    });
    if (created.length > 0) onSelectionChange(created);
  };

  const rotate = (): void => {
    onUpdateRoom((draft) => {
      for (const key of selection) {
        const parsed = parseSelectionKey(key);
        if (!parsed) continue;
        if (parsed.kind === 'center') {
          const center = draft.centers.find((item) => item.id === parsed.id);
          if (center) center.rotation = rotateBy90(center.rotation);
        }
        if (parsed.kind === 'object') {
          const object = draft.objects.find((item) => item.id === parsed.id);
          if (object) object.rotation = rotateBy90(object.rotation);
        }
        if (parsed.kind === 'label') {
          const label = draft.labels.find((item) => item.id === parsed.id);
          if (label) label.rotation = rotateBy90(label.rotation);
        }
      }
    });
  };

  const setBounds = (patch: Partial<{ x: number; y: number; width: number; height: number }>): void => {
    if (!single || !bounds) return;
    onUpdateRoom((draft) => {
      applyResize(draft, `${single.kind}:${single.id}`, { ...bounds, ...patch });
    });
  };

  return (
    <Panel
      title={t('editor.properties')}
      className="tertiary"
      actions={
        selection.length > 0 ? (
          <>
            <button type="button" className="subtle" onClick={rotate}>
              {t('editor.rotate')}
            </button>
            <button type="button" className="subtle" onClick={duplicate}>
              {t('editor.duplicate')}
            </button>
            <button type="button" className="subtle danger" onClick={remove}>
              {t('editor.delete')}
            </button>
          </>
        ) : null
      }
    >
      {selection.length === 0 ? (
        <p className="empty-state">{t('editor.properties.empty')}</p>
      ) : selection.length > 1 ? (
        <p className="muted">{t('editor.selection.count', { count: selection.length })}</p>
      ) : null}

      {single && bounds ? (
        <>
          <div className="field-row">
            <NumberField
              label={t('editor.property.x')}
              value={bounds.x}
              onChange={(value) => setBounds({ x: value })}
            />
            <NumberField
              label={t('editor.property.y')}
              value={bounds.y}
              onChange={(value) => setBounds({ y: value })}
            />
          </div>
          <div className="field-row">
            <NumberField
              label={t('editor.property.width')}
              value={bounds.width}
              min={SEAT_SIZE / 2}
              onChange={(value) => setBounds({ width: value })}
            />
            <NumberField
              label={t('editor.property.height')}
              value={bounds.height}
              min={SEAT_SIZE / 2}
              onChange={(value) => setBounds({ height: value })}
            />
          </div>
        </>
      ) : null}

      {single?.kind === 'center'
        ? (() => {
            const center = room.centers.find((item) => item.id === single.id);
            if (!center) return null;
            return (
              <TextField
                label={t('editor.property.name')}
                value={center.name ?? ''}
                onChange={(value) =>
                  onUpdateRoom((draft) => {
                    const target = draft.centers.find((item) => item.id === single.id);
                    if (target) target.name = value;
                  })
                }
              />
            );
          })()
        : null}

      {single?.kind === 'object'
        ? (() => {
            const object = room.objects.find((item) => item.id === single.id);
            if (!object) return null;
            return (
              <>
                <TextField
                  label={t('editor.property.name')}
                  value={object.name}
                  onChange={(value) =>
                    onUpdateRoom((draft) => {
                      const target = draft.objects.find((item) => item.id === single.id);
                      if (target) target.name = value;
                    })
                  }
                />
                <Toggle
                  label={t('editor.property.visibleInExport')}
                  checked={object.visibleInExport}
                  onChange={(value) =>
                    onUpdateRoom((draft) => {
                      const target = draft.objects.find((item) => item.id === single.id);
                      if (target) target.visibleInExport = value;
                    })
                  }
                />
              </>
            );
          })()
        : null}

      {single?.kind === 'region'
        ? (() => {
            const region = room.regions.find((item) => item.id === single.id);
            if (!region) return null;
            return (
              <>
                <TextField
                  label={t('editor.property.name')}
                  value={region.name}
                  onChange={(value) =>
                    onUpdateRoom((draft) => {
                      const target = draft.regions.find((item) => item.id === single.id);
                      if (target) target.name = value;
                    })
                  }
                />
                <Toggle
                  label={t('editor.property.visibleInExport')}
                  checked={region.visibleInExport}
                  onChange={(value) =>
                    onUpdateRoom((draft) => {
                      const target = draft.regions.find((item) => item.id === single.id);
                      if (target) target.visibleInExport = value;
                    })
                  }
                />
              </>
            );
          })()
        : null}

      {single?.kind === 'label'
        ? (() => {
            const label = room.labels.find((item) => item.id === single.id);
            if (!label) return null;
            return (
              <>
                <TextField
                  label={t('editor.property.text')}
                  value={label.text}
                  onChange={(value) =>
                    onUpdateRoom((draft) => {
                      const target = draft.labels.find((item) => item.id === single.id);
                      if (target) target.text = value;
                    })
                  }
                />
                <NumberField
                  label={t('editor.property.fontSize')}
                  value={label.fontSize}
                  min={6}
                  onChange={(value) =>
                    onUpdateRoom((draft) => {
                      const target = draft.labels.find((item) => item.id === single.id);
                      if (target) target.fontSize = value;
                    })
                  }
                />
              </>
            );
          })()
        : null}
    </Panel>
  );
}

export type { RoomCanvasProps };
