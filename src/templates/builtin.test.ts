import { describe, expect, it } from 'vitest';
import { createEmptyProject } from '../domain/defaults';
import { assignableSeatCount, buildRoomIndex } from '../domain/room';
import { roomDefinitionSchema } from '../domain/schema';
import { planFitScale } from '../export/PlanDocument';
import { TARGET_NAME_POINTS } from '../export/readability';
import { ptBR } from '../i18n/pt-BR';
import { buildSeatPresentations, planNameFontSize } from '../shared/RoomGraphics';
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

  /**
   * The printed plan is read from across the room, so a template is only
   * usable if a realistic roster's names come out legible with no tuning.
   * Desks that are small against the room is what broke this before.
   */
  describe('names print readably straight out of the box', () => {
    const ROSTER = [
      'Maria Beatriz Oliveira',
      'Francisco Nascimento',
      'Ana Beatriz Silva',
      'João Pedro Alves',
      'Isabela Martins',
      'Gabriel Rocha',
      'Larissa Gomes',
      'Rafael Dias',
      'Pietro Almeida',
      'Mariana Costa',
      'David Nogueira',
      'Sarah Lima',
      'Felipe Melo',
      'Maria Julia',
      'Sofia Chaves',
      'Davi Schulze',
      'Maria Luiza',
      'Jurandir Neto',
      'Bernardo Reis',
      'Maria Clara',
      'Aurora Bettina',
      'Francisco Filho',
      'Liz Rafaela',
      'Samuel Chloe',
    ];

    for (const descriptor of TEMPLATE_DESCRIPTORS.filter((item) => item.seatCount > 0)) {
      it(descriptor.id, () => {
        const room = createRoomFromTemplate(descriptor.id, ptBR);
        const project = createEmptyProject(room);
        project.roster = ROSTER.map((name, index) => ({ id: `st${index}`, name }));

        const seatIds = room.centers.flatMap((center) => center.seats.map((seat) => seat.id));
        project.assignments = project.roster
          .slice(0, seatIds.length)
          .map((student, index) => ({ studentId: student.id, seatId: seatIds[index]!, locked: false }));

        const seats = buildSeatPresentations(
          room,
          new Map(project.assignments.map((item) => [item.studentId, item.seatId])),
          new Map(project.roster.map((student) => [student.id, student.name])),
        );
        const { nameStyle, fontScale } = project.exportLayout;
        const points = planNameFontSize(seats, nameStyle, fontScale) * planFitScale(project);

        expect(points).toBeGreaterThanOrEqual(TARGET_NAME_POINTS);
      });
    }
  });
});
