/// <reference lib="webworker" />

/**
 * Generation worker (TECHNICAL_SPEC §7.6).
 *
 * The attempt loop yields to the worker's message queue between attempts via
 * `setTimeout(0)`. That is what makes cancellation real: a `cancel` message
 * sent while a run is in flight is actually delivered, instead of sitting
 * behind a long synchronous computation.
 */

import { createRun } from './solve';
import type { SolverRequest, SolverResponse } from './protocol';
import type { GenerationProgress } from './types';

const scope = self as unknown as DedicatedWorkerGlobalScope;

const cancelledRequests = new Set<string>();
let activeRequestId: string | null = null;

function post(message: SolverResponse): void {
  scope.postMessage(message);
}

function runIncrementally(request: Extract<SolverRequest, { type: 'solve' }>): void {
  const { requestId } = request;
  activeRequestId = requestId;

  let lastProgress: GenerationProgress | null = null;

  const run = createRun(request.project, {
    ...(request.keepAssignments ? { keepAssignments: request.keepAssignments } : {}),
    ...(request.seed !== undefined ? { seed: request.seed } : {}),
    shouldCancel: () => cancelledRequests.has(requestId),
    onProgress: (progress) => {
      lastProgress = progress;
    },
  });

  const finish = (): void => {
    const cancelled = cancelledRequests.has(requestId);
    cancelledRequests.delete(requestId);
    if (activeRequestId === requestId) activeRequestId = null;
    post({ type: 'result', requestId, result: run.result(), cancelled });
  };

  const pump = (): void => {
    try {
      if (cancelledRequests.has(requestId)) {
        finish();
        return;
      }

      const hasMore = run.step();
      if (lastProgress) {
        post({ type: 'progress', requestId, progress: lastProgress });
        lastProgress = null;
      }

      if (hasMore) {
        // Yielding lets pending `cancel` messages be delivered.
        setTimeout(pump, 0);
      } else {
        finish();
      }
    } catch (error) {
      cancelledRequests.delete(requestId);
      if (activeRequestId === requestId) activeRequestId = null;
      post({
        type: 'error',
        requestId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  };

  pump();
}

scope.onmessage = (event: MessageEvent<SolverRequest>): void => {
  const request = event.data;
  if (request.type === 'cancel') {
    cancelledRequests.add(request.requestId);
    return;
  }
  if (request.type === 'solve') {
    // A new run supersedes whatever was in flight.
    if (activeRequestId !== null) cancelledRequests.add(activeRequestId);
    runIncrementally(request);
  }
};
