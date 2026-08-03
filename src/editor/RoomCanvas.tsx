/**
 * The interactive room canvas (TECHNICAL_SPEC §8).
 *
 * Plain SVG rather than a canvas library: the export pipeline is SVG, so using
 * it here too means there is one scene description instead of two that have to
 * be kept in sync. It also gives real DOM nodes, which is what makes seats
 * focusable and reachable by keyboard without reimplementing hit testing.
 *
 * The same component serves two modes. In `edit` mode the user manipulates room
 * geometry; in `plan` mode the geometry is frozen and seats become drop targets
 * for students.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { SEAT_SIZE } from '../domain/defaults';
import { rotatedBounds } from '../domain/geometry';
import type { Rect, RoomDefinition } from '../domain/types';
import { useMessages } from '../i18n/useMessages';
import {
  CenterOutline,
  ObjectShape,
  RegionShape,
  SeatShape,
  TextLabelShape,
} from '../shared/RoomGraphics';
import type { RoomViewOptions, SeatPresentation } from '../shared/RoomGraphics';
import { parseSelectionKey, selectionKey } from '../app/selection';
import type { SelectableKind } from '../app/selection';
import {
  RESIZE_HANDLES,
  collectItemBounds,
  computeSnap,
  handlePosition,
  normalizeRect,
  rectsIntersect,
  resizeRect,
  scaleSeatOffsets,
  selectionBounds,
} from './canvasMath';
import type { Guide, ResizeHandle } from './canvasMath';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 4;
const SNAP_THRESHOLD_UNITS = 6;
const HANDLE_SIZE = 9;

export interface RoomCanvasProps {
  room: RoomDefinition;
  seats: SeatPresentation[];
  options: RoomViewOptions;
  mode: 'edit' | 'plan';
  selection: string[];
  viewport: { zoom: number; panX: number; panY: number };
  onViewportChange: (viewport: Partial<{ zoom: number; panX: number; panY: number }>) => void;
  onSelectionChange: (keys: string[]) => void;
  /** Applies a geometry change; called once at the end of a drag. */
  onMoveItems?: (keys: string[], dx: number, dy: number) => void;
  onResizeItem?: (key: string, bounds: Rect) => void;
  /** Plan mode: a student was dropped on, or a seat was activated for, this seat. */
  onSeatActivate?: (seatId: string) => void;
  onSeatDropStudent?: (seatId: string, studentId: string) => void;
  activeStudentId?: string | null;
}

interface DragState {
  kind: 'move' | 'marquee' | 'pan' | 'resize' | 'seat';
  pointerId: number;
  startRoom: { x: number; y: number };
  currentRoom: { x: number; y: number };
  startPan?: { x: number; y: number };
  keys?: string[];
  handle?: ResizeHandle;
  originalBounds?: Rect;
  seatId?: string;
  studentId?: string;
}

export function RoomCanvas(props: RoomCanvasProps): JSX.Element {
  const { t } = useMessages();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [guides, setGuides] = useState<Guide[]>([]);
  const [hoverSeatId, setHoverSeatId] = useState<string | null>(null);
  const pinchRef = useRef<Map<number, { x: number; y: number }>>(new Map());

  const { room, seats, options, mode, selection, viewport } = props;
  const selectionSet = useMemo(() => new Set(selection), [selection]);

  // -- Coordinate conversion ------------------------------------------------

  const toRoom = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - viewport.panX) / viewport.zoom,
        y: (clientY - rect.top - viewport.panY) / viewport.zoom,
      };
    },
    [viewport.panX, viewport.panY, viewport.zoom],
  );

  /** Centres the room in the container. */
  const fitToView = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const { clientWidth, clientHeight } = container;
    if (clientWidth === 0 || clientHeight === 0) return;

    const padding = 24;
    const zoom = Math.min(
      (clientWidth - padding * 2) / room.width,
      (clientHeight - padding * 2) / room.height,
    );
    const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
    props.onViewportChange({
      zoom: clamped,
      panX: (clientWidth - room.width * clamped) / 2,
      panY: (clientHeight - room.height * clamped) / 2,
    });
  }, [props, room.height, room.width]);

  const didFit = useRef(false);
  useLayoutEffect(() => {
    if (didFit.current) return;
    didFit.current = true;
    fitToView();
  }, [fitToView]);

  // -- Zoom -----------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (event: WheelEvent): void => {
      event.preventDefault();
      const rect = container.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      const factor = Math.exp(-event.deltaY * 0.0015);
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom * factor));
      // Keep the point under the cursor fixed while zooming.
      const ratio = zoom / viewport.zoom;
      props.onViewportChange({
        zoom,
        panX: pointerX - (pointerX - viewport.panX) * ratio,
        panY: pointerY - (pointerY - viewport.panY) * ratio,
      });
    };

    container.addEventListener('wheel', onWheel, { passive: false });
    return () => container.removeEventListener('wheel', onWheel);
  }, [props, viewport.panX, viewport.panY, viewport.zoom]);

  // -- Dragging -------------------------------------------------------------

  const beginDrag = (event: ReactPointerEvent, state: Omit<DragState, 'pointerId'>): void => {
    (event.target as Element).setPointerCapture?.(event.pointerId);
    setDrag({ ...state, pointerId: event.pointerId });
  };

  const onBackgroundPointerDown = (event: ReactPointerEvent<SVGRectElement>): void => {
    pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinchRef.current.size > 1) return;

    const point = toRoom(event.clientX, event.clientY);
    const panning = event.button === 1 || event.altKey || mode === 'plan';

    if (panning) {
      beginDrag(event, {
        kind: 'pan',
        startRoom: { x: event.clientX, y: event.clientY },
        currentRoom: { x: event.clientX, y: event.clientY },
        startPan: { x: viewport.panX, y: viewport.panY },
      });
      return;
    }

    if (!event.shiftKey) props.onSelectionChange([]);
    beginDrag(event, { kind: 'marquee', startRoom: point, currentRoom: point });
  };

  const onItemPointerDown = (
    event: ReactPointerEvent,
    kind: SelectableKind,
    id: string,
  ): void => {
    if (mode !== 'edit') return;
    event.stopPropagation();

    const key = selectionKey(kind, id);
    const additive = event.shiftKey;
    const nextSelection = additive
      ? selectionSet.has(key)
        ? selection.filter((item) => item !== key)
        : [...selection, key]
      : selectionSet.has(key)
        ? selection
        : [key];

    props.onSelectionChange(nextSelection);

    const point = toRoom(event.clientX, event.clientY);
    beginDrag(event, {
      kind: 'move',
      startRoom: point,
      currentRoom: point,
      keys: nextSelection,
    });
  };

  const onHandlePointerDown = (
    event: ReactPointerEvent,
    handle: ResizeHandle,
    key: string,
    bounds: Rect,
  ): void => {
    event.stopPropagation();
    const point = toRoom(event.clientX, event.clientY);
    beginDrag(event, {
      kind: 'resize',
      startRoom: point,
      currentRoom: point,
      keys: [key],
      handle,
      originalBounds: bounds,
    });
  };

  const onSeatPointerDown = (
    event: ReactPointerEvent<SVGGElement>,
    presentation: SeatPresentation,
  ): void => {
    if (mode !== 'plan' || !presentation.studentId) return;
    event.stopPropagation();
    const point = toRoom(event.clientX, event.clientY);
    beginDrag(event, {
      kind: 'seat',
      startRoom: point,
      currentRoom: point,
      seatId: presentation.seat.id,
      studentId: presentation.studentId,
    });
  };

  const seatAt = useCallback(
    (point: { x: number; y: number }): SeatPresentation | null => {
      let best: SeatPresentation | null = null;
      let bestDistance = SEAT_SIZE * 0.75;
      for (const seat of seats) {
        if (!seat.seat.enabled) continue;
        const distance = Math.hypot(seat.x - point.x, seat.y - point.y);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = seat;
        }
      }
      return best;
    },
    [seats],
  );

  const onPointerMove = (event: ReactPointerEvent): void => {
    if (pinchRef.current.has(event.pointerId)) {
      pinchRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (!drag || drag.pointerId !== event.pointerId) return;

    if (drag.kind === 'pan' && drag.startPan) {
      props.onViewportChange({
        panX: drag.startPan.x + (event.clientX - drag.startRoom.x),
        panY: drag.startPan.y + (event.clientY - drag.startRoom.y),
      });
      return;
    }

    const point = toRoom(event.clientX, event.clientY);
    setDrag({ ...drag, currentRoom: point });

    if (drag.kind === 'seat') {
      setHoverSeatId(seatAt(point)?.seat.id ?? null);
      return;
    }

    if (drag.kind === 'move' && drag.keys && drag.keys.length > 0) {
      const excluded = new Set(drag.keys);
      const moving = collectItemBounds(room).filter((item) => excluded.has(item.key));
      const bounds = selectionBounds(moving);
      if (!bounds) return;

      const proposed = {
        ...bounds,
        x: bounds.x + (point.x - drag.startRoom.x),
        y: bounds.y + (point.y - drag.startRoom.y),
      };
      const snap = computeSnap(proposed, collectItemBounds(room, excluded).map((item) => item.bounds), {
        gridSize: room.grid.size,
        snapToGrid: room.grid.snap,
        threshold: SNAP_THRESHOLD_UNITS,
      });
      setGuides(snap.guides);
    }
  };

  const endDrag = (event: ReactPointerEvent): void => {
    pinchRef.current.delete(event.pointerId);
    if (!drag || drag.pointerId !== event.pointerId) return;

    const point = toRoom(event.clientX, event.clientY);

    if (drag.kind === 'marquee') {
      const marquee = normalizeRect(drag.startRoom, point);
      if (marquee.width > 4 || marquee.height > 4) {
        const hits = collectItemBounds(room)
          .filter((item) => rectsIntersect(item.bounds, marquee))
          .map((item) => item.key);
        props.onSelectionChange(event.shiftKey ? [...new Set([...selection, ...hits])] : hits);
      }
    }

    if (drag.kind === 'move' && drag.keys && drag.keys.length > 0) {
      const excluded = new Set(drag.keys);
      const moving = collectItemBounds(room).filter((item) => excluded.has(item.key));
      const bounds = selectionBounds(moving);
      if (bounds) {
        const rawDx = point.x - drag.startRoom.x;
        const rawDy = point.y - drag.startRoom.y;
        const proposed = { ...bounds, x: bounds.x + rawDx, y: bounds.y + rawDy };
        const snap = computeSnap(
          proposed,
          collectItemBounds(room, excluded).map((item) => item.bounds),
          {
            gridSize: room.grid.size,
            snapToGrid: room.grid.snap,
            threshold: SNAP_THRESHOLD_UNITS,
          },
        );
        const dx = rawDx + snap.dx;
        const dy = rawDy + snap.dy;
        if (dx !== 0 || dy !== 0) props.onMoveItems?.(drag.keys, dx, dy);
      }
    }

    if (drag.kind === 'resize' && drag.keys?.[0] && drag.handle && drag.originalBounds) {
      const next = resizeRect(
        drag.originalBounds,
        drag.handle,
        point.x - drag.startRoom.x,
        point.y - drag.startRoom.y,
      );
      props.onResizeItem?.(drag.keys[0], next);
    }

    if (drag.kind === 'seat' && drag.studentId) {
      const target = seatAt(point);
      if (target && target.seat.id !== drag.seatId) {
        props.onSeatDropStudent?.(target.seat.id, drag.studentId);
      }
    }

    setDrag(null);
    setGuides([]);
    setHoverSeatId(null);
  };

  // -- Drag and drop from the roster list -----------------------------------

  const onDragOver = (event: React.DragEvent<SVGSVGElement>): void => {
    if (mode !== 'plan') return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const point = toRoom(event.clientX, event.clientY);
    setHoverSeatId(seatAt(point)?.seat.id ?? null);
  };

  const onDrop = (event: React.DragEvent<SVGSVGElement>): void => {
    if (mode !== 'plan') return;
    event.preventDefault();
    const studentId = event.dataTransfer.getData('text/student-id');
    setHoverSeatId(null);
    if (!studentId) return;
    const target = seatAt(toRoom(event.clientX, event.clientY));
    if (target) props.onSeatDropStudent?.(target.seat.id, studentId);
  };

  // -- Derived --------------------------------------------------------------

  const selectedItems = useMemo(
    () => collectItemBounds(room).filter((item) => selectionSet.has(item.key)),
    [room, selectionSet],
  );
  const activeBounds = selectionBounds(selectedItems);
  const singleSelectionKey = selection.length === 1 ? selection[0] : undefined;

  const marqueeRect =
    drag?.kind === 'marquee' ? normalizeRect(drag.startRoom, drag.currentRoom) : null;

  const moveOffset =
    drag?.kind === 'move'
      ? { x: drag.currentRoom.x - drag.startRoom.x, y: drag.currentRoom.y - drag.startRoom.y }
      : null;

  const isSelected = (kind: SelectableKind, id: string): boolean =>
    selectionSet.has(selectionKey(kind, id));

  const dragTransform = (kind: SelectableKind, id: string): string | undefined => {
    if (!moveOffset || !isSelected(kind, id)) return undefined;
    return `translate(${moveOffset.x} ${moveOffset.y})`;
  };

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <svg
        ref={svgRef}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDragOver={onDragOver}
        onDrop={onDrop}
        role="application"
        aria-label={t(mode === 'edit' ? 'editor.title' : 'plan.title')}
      >
        <defs>
          <pattern
            id="grid-pattern"
            width={room.grid.size * viewport.zoom}
            height={room.grid.size * viewport.zoom}
            patternUnits="userSpaceOnUse"
            x={viewport.panX}
            y={viewport.panY}
          >
            <path
              d={`M ${room.grid.size * viewport.zoom} 0 L 0 0 0 ${room.grid.size * viewport.zoom}`}
              fill="none"
              stroke="var(--border)"
              strokeWidth={1}
              opacity={0.6}
            />
          </pattern>
        </defs>

        <g transform={`translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`}>
          <rect
            x={0}
            y={0}
            width={room.width}
            height={room.height}
            fill="var(--surface)"
            stroke="var(--border-strong)"
            strokeWidth={2 / viewport.zoom}
            onPointerDown={onBackgroundPointerDown}
          />
        </g>

        {room.grid.visible ? (
          <rect
            x={viewport.panX}
            y={viewport.panY}
            width={room.width * viewport.zoom}
            height={room.height * viewport.zoom}
            fill="url(#grid-pattern)"
            pointerEvents="none"
          />
        ) : null}

        <g transform={`translate(${viewport.panX} ${viewport.panY}) scale(${viewport.zoom})`}>
          {options.showRegions
            ? room.regions
                .filter((region) => region.visibleInEditor)
                .map((region) => (
                  <g
                    key={region.id}
                    transform={dragTransform('region', region.id)}
                    onPointerDown={(event) => onItemPointerDown(event, 'region', region.id)}
                    style={mode === 'edit' ? { cursor: 'move' } : undefined}
                  >
                    <RegionShape region={region} selected={isSelected('region', region.id)} />
                  </g>
                ))
            : null}

          {options.showObjects
            ? room.objects.map((object) => (
                <g key={object.id} transform={dragTransform('object', object.id)}>
                  <ObjectShape
                    object={object}
                    selected={isSelected('object', object.id)}
                    {...(mode === 'edit'
                      ? { onPointerDown: (event) => onItemPointerDown(event, 'object', object.id) }
                      : {})}
                  />
                </g>
              ))
            : null}

          {room.centers.map((center) => (
            <g key={center.id} transform={dragTransform('center', center.id)}>
              {options.showCenterOutlines ? (
                <CenterOutline
                  center={center}
                  selected={isSelected('center', center.id)}
                  {...(mode === 'edit'
                    ? { onPointerDown: (event) => onItemPointerDown(event, 'center', center.id) }
                    : {})}
                />
              ) : null}
              {seats
                .filter((presentation) => presentation.center.id === center.id)
                .map((presentation) => (
                  <SeatShape
                    key={presentation.seat.id}
                    presentation={presentation}
                    options={options}
                    interactive
                    selected={isSelected('seat', presentation.seat.id)}
                    dropTarget={hoverSeatId === presentation.seat.id}
                    onPointerDown={(event) => {
                      if (mode === 'edit') onItemPointerDown(event, 'seat', presentation.seat.id);
                      else onSeatPointerDown(event, presentation);
                    }}
                    onClick={() => {
                      if (mode === 'plan') props.onSeatActivate?.(presentation.seat.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        if (mode === 'plan') props.onSeatActivate?.(presentation.seat.id);
                      }
                    }}
                    ariaLabel={
                      presentation.studentName ??
                      `${t('plan.emptySeat')} ${presentation.seat.label ?? presentation.seat.id}`
                    }
                  />
                ))}
            </g>
          ))}

          {room.labels.map((label) => (
            <g
              key={label.id}
              transform={dragTransform('label', label.id)}
              onPointerDown={(event) => onItemPointerDown(event, 'label', label.id)}
              style={mode === 'edit' ? { cursor: 'move' } : undefined}
            >
              <TextLabelShape label={label} />
            </g>
          ))}

          {/* Alignment guides */}
          {guides.map((guide, index) => (
            <line
              key={`${guide.orientation}-${String(index)}`}
              x1={guide.orientation === 'vertical' ? guide.position : 0}
              x2={guide.orientation === 'vertical' ? guide.position : room.width}
              y1={guide.orientation === 'horizontal' ? guide.position : 0}
              y2={guide.orientation === 'horizontal' ? guide.position : room.height}
              stroke="var(--accent)"
              strokeWidth={1 / viewport.zoom}
              strokeDasharray="4 4"
              pointerEvents="none"
            />
          ))}

          {marqueeRect ? (
            <rect
              x={marqueeRect.x}
              y={marqueeRect.y}
              width={marqueeRect.width}
              height={marqueeRect.height}
              fill="var(--accent)"
              fillOpacity={0.12}
              stroke="var(--accent)"
              strokeWidth={1 / viewport.zoom}
              pointerEvents="none"
            />
          ) : null}

          {mode === 'edit' && activeBounds ? (
            <rect
              x={activeBounds.x - 4}
              y={activeBounds.y - 4}
              width={activeBounds.width + 8}
              height={activeBounds.height + 8}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={1 / viewport.zoom}
              strokeDasharray="6 4"
              pointerEvents="none"
            />
          ) : null}

          {/* Resize handles: single selection only, and never for seats, whose
              size is fixed by the seat model. */}
          {mode === 'edit' &&
          activeBounds &&
          singleSelectionKey &&
          parseSelectionKey(singleSelectionKey)?.kind !== 'seat' &&
          parseSelectionKey(singleSelectionKey)?.kind !== 'label'
            ? RESIZE_HANDLES.map((handle) => {
                const position = handlePosition(activeBounds, handle);
                const size = HANDLE_SIZE / viewport.zoom;
                return (
                  <rect
                    key={handle}
                    x={position.x - size / 2}
                    y={position.y - size / 2}
                    width={size}
                    height={size}
                    fill="var(--surface)"
                    stroke="var(--accent)"
                    strokeWidth={1.5 / viewport.zoom}
                    style={{ cursor: `${handle}-resize` }}
                    onPointerDown={(event) =>
                      onHandlePointerDown(event, handle, singleSelectionKey, activeBounds)
                    }
                  />
                );
              })
            : null}
        </g>
      </svg>
    </div>
  );
}

/**
 * Applies a resize to a room item, scaling a center's seat offsets with it so
 * the arrangement is preserved.
 */
export function applyResize(room: RoomDefinition, key: string, bounds: Rect): void {
  const parsed = parseSelectionKey(key);
  if (!parsed) return;

  if (parsed.kind === 'center') {
    const center = room.centers.find((item) => item.id === parsed.id);
    if (!center) return;
    const previous = rotatedBounds(center, center.rotation);
    const scaled = scaleSeatOffsets(center.seats, previous, bounds);
    center.x = bounds.x;
    center.y = bounds.y;
    center.width = center.rotation === 90 || center.rotation === 270 ? bounds.height : bounds.width;
    center.height =
      center.rotation === 90 || center.rotation === 270 ? bounds.width : bounds.height;
    center.seats = center.seats.map((seat, index) => ({
      ...seat,
      x: scaled[index]?.x ?? seat.x,
      y: scaled[index]?.y ?? seat.y,
    }));
    return;
  }

  if (parsed.kind === 'object') {
    const object = room.objects.find((item) => item.id === parsed.id);
    if (!object) return;
    object.x = bounds.x;
    object.y = bounds.y;
    object.width = object.rotation === 90 || object.rotation === 270 ? bounds.height : bounds.width;
    object.height =
      object.rotation === 90 || object.rotation === 270 ? bounds.width : bounds.height;
    return;
  }

  if (parsed.kind === 'region') {
    const region = room.regions.find((item) => item.id === parsed.id);
    if (!region || region.geometry.type !== 'rectangle') return;
    region.geometry = { type: 'rectangle', ...bounds };
  }
}

/** Moves every selected item by the same offset. */
export function applyMove(room: RoomDefinition, keys: readonly string[], dx: number, dy: number): void {
  for (const key of keys) {
    const parsed = parseSelectionKey(key);
    if (!parsed) continue;

    switch (parsed.kind) {
      case 'center': {
        const center = room.centers.find((item) => item.id === parsed.id);
        if (center) {
          center.x += dx;
          center.y += dy;
        }
        break;
      }
      case 'object': {
        const object = room.objects.find((item) => item.id === parsed.id);
        if (object) {
          object.x += dx;
          object.y += dy;
        }
        break;
      }
      case 'region': {
        const region = room.regions.find((item) => item.id === parsed.id);
        if (!region) break;
        if (region.geometry.type === 'rectangle') {
          region.geometry.x += dx;
          region.geometry.y += dy;
        } else {
          region.geometry.points = region.geometry.points.map((point) => ({
            x: point.x + dx,
            y: point.y + dy,
          }));
        }
        break;
      }
      case 'label': {
        const label = room.labels.find((item) => item.id === parsed.id);
        if (label) {
          label.x += dx;
          label.y += dy;
        }
        break;
      }
      case 'seat': {
        // Seats move with their center; dragging a seat alone adjusts its
        // offset inside the group.
        for (const center of room.centers) {
          const seat = center.seats.find((item) => item.id === parsed.id);
          if (seat) {
            seat.x += dx;
            seat.y += dy;
            break;
          }
        }
        break;
      }
    }
  }
}
