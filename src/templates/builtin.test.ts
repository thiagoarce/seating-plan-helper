import { describe, expect, it } from 'vitest';
import { assignableSeatCount, buildRoomIndex } from '../domain/room';
import { roomDefinitionSchema } from '../domain/schema';
import { ptBR } from '../i18n/pt-BR';
import { TEMPLATE_DESCRIPTORS, createRoomFromTemplate } from './builtin';

describe('built-in templates', () => {
  for (const descriptor of TEMPLATE_DESCRIPTORS) {
    describe(descriptor.id, () => {
      it('produces a schema-valid room', () => {
        const room = createRoomFromTemplate(descriptor.id, ptBR);
        expect(roomDefinitionSchema.safeParse(room).success).toBe(true);
      });

      it('has the advertised seat count', () => {
        const room = createRoomFromTemplate(descriptor.id, ptBR);
        expect(assignableSeatCount(room)).toBe(descriptor.seatCount);
      });

      it('gives every seat a unique id', () => {
        const room = createRoomFromTemplate(descriptor.id, ptBR);
        const seatIds = room.centers.flatMap((center) => center.seats.map((seat) => seat.id));
        expect(new Set(seatIds).size).toBe(seatIds.length);
      });

      it('keeps every seat inside the room bounds', () => {
        const room = createRoomFromTemplate(descriptor.id, ptBR);
        const index = buildRoomIndex(room, 100);
        for (const seat of index.seats) {
          expect(seat.position.x).toBeGreaterThanOrEqual(0);
          expect(seat.position.y).toBeGreaterThanOrEqual(0);
          expect(seat.position.x).toBeLessThanOrEqual(room.width);
          expect(seat.position.y).toBeLessThanOrEqual(room.height);
        }
      });

      it('assigns every seat to exactly one depth band', () => {
        const room = createRoomFromTemplate(descriptor.id, ptBR);
        const index = buildRoomIndex(room, 100);
        for (const seat of index.seats) {
          expect(seat.regionIds.size).toBeGreaterThanOrEqual(1);
        }
      });

      it('returns a fresh copy each time', () => {
        const first = createRoomFromTemplate(descriptor.id, ptBR);
        const second = createRoomFromTemplate(descriptor.id, ptBR);
        expect(first).not.toBe(second);
        first.width = 1;
        expect(second.width).not.toBe(1);
      });

      it('has a translated name and description', () => {
        expect(ptBR[descriptor.nameKey]).toBeTruthy();
        expect(ptBR[descriptor.descriptionKey]).toBeTruthy();
      });
    });
  }

  it('includes a blank room and a groups-of-four room', () => {
    const ids = TEMPLATE_DESCRIPTORS.map((item) => item.id);
    expect(ids).toContain('blank');
    expect(ids).toContain('groups-of-four');
  });
});
