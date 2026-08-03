/**
 * Main-thread handle for the generation worker.
 *
 * Falls back to solving on the main thread when workers are unavailable (very
 * old browsers, some embedded webviews). The fallback blocks, so it keeps the
 * project's time budget as its only protection — the worker path is the one
 * that keeps the UI at 60 fps.
 */

import type { SeatAssignment, SeatingProject } from '../domain/types';
import { createId } from '../shared/id';
import type { SolverRequest, SolverResponse } from './protocol';
import { solve } from './solve';
import type { GenerationProgress, GenerationResult } from './types';

export interface GenerateOptions {
  keepAssignments?: SeatAssignment[];
  seed?: number;
  onProgress?: (progress: GenerationProgress) => void;
}

export interface GenerationHandle {
  promise: Promise<GenerationResult>;
  cancel: () => void;
}

function supportsWorker(): boolean {
  return typeof Worker !== 'undefined';
}

export class SolverClient {
  #worker: Worker | null = null;

  #ensureWorker(): Worker | null {
    if (!supportsWorker()) return null;
    if (!this.#worker) {
      this.#worker = new Worker(new URL('./solver.worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return this.#worker;
  }

  generate(project: SeatingProject, options: GenerateOptions = {}): GenerationHandle {
    const worker = this.#ensureWorker();
    const requestId = createId('run');

    if (!worker) {
      let cancelled = false;
      const promise = Promise.resolve().then(() =>
        solve(project, {
          ...(options.keepAssignments ? { keepAssignments: options.keepAssignments } : {}),
          ...(options.seed !== undefined ? { seed: options.seed } : {}),
          ...(options.onProgress ? { onProgress: options.onProgress } : {}),
          shouldCancel: () => cancelled,
        }),
      );
      return {
        promise,
        cancel: () => {
          cancelled = true;
        },
      };
    }

    const promise = new Promise<GenerationResult>((resolve, reject) => {
      const handleMessage = (event: MessageEvent<SolverResponse>): void => {
        const message = event.data;
        if (message.requestId !== requestId) return;

        if (message.type === 'progress') {
          options.onProgress?.(message.progress);
          return;
        }
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        if (message.type === 'result') resolve(message.result);
        else reject(new Error(message.message));
      };

      const handleError = (event: ErrorEvent): void => {
        worker.removeEventListener('message', handleMessage);
        worker.removeEventListener('error', handleError);
        reject(new Error(event.message));
      };

      worker.addEventListener('message', handleMessage);
      worker.addEventListener('error', handleError);

      const request: SolverRequest = {
        type: 'solve',
        requestId,
        project,
        ...(options.keepAssignments ? { keepAssignments: options.keepAssignments } : {}),
        ...(options.seed !== undefined ? { seed: options.seed } : {}),
      };
      worker.postMessage(request);
    });

    return {
      promise,
      cancel: () => {
        const request: SolverRequest = { type: 'cancel', requestId };
        worker.postMessage(request);
      },
    };
  }

  /** Releases the worker; the next `generate` call spins up a fresh one. */
  dispose(): void {
    this.#worker?.terminate();
    this.#worker = null;
  }
}

export const solverClient = new SolverClient();
