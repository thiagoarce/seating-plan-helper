/**
 * Message protocol between the main thread and the generation worker
 * (TECHNICAL_SPEC §7.6).
 */

import type { SeatAssignment, SeatingProject } from '../domain/types';
import type { GenerationProgress, GenerationResult } from './types';

export interface SolveRequest {
  type: 'solve';
  requestId: string;
  project: SeatingProject;
  keepAssignments?: SeatAssignment[];
  seed?: number;
}

export interface CancelRequest {
  type: 'cancel';
  requestId: string;
}

export type SolverRequest = SolveRequest | CancelRequest;

export interface ProgressResponse {
  type: 'progress';
  requestId: string;
  progress: GenerationProgress;
}

export interface ResultResponse {
  type: 'result';
  requestId: string;
  result: GenerationResult;
  cancelled: boolean;
}

export interface ErrorResponse {
  type: 'error';
  requestId: string;
  message: string;
}

export type SolverResponse = ProgressResponse | ResultResponse | ErrorResponse;
