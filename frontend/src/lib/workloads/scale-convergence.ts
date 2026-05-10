export type ScaleConvergenceStatus = "accepted" | "converging" | "stable" | "timeout";

export type ScaleObservedState = {
  desiredReplicas?: number | null;
  observedReplicas?: number | null;
  readyReplicas?: number | null;
  availableReplicas?: number | null;
  observedAt?: string;
  status?: ScaleConvergenceStatus | string;
};

export type ScaleConvergenceRound = {
  status: ScaleConvergenceStatus;
  attempt: number;
  maxAttempts: number;
  elapsedMs: number;
  observed: {
    desiredReplicas: number;
    observedReplicas: number | null;
    readyReplicas: number | null;
    availableReplicas?: number | null;
    observedAt?: string;
  };
};

export type RunScaleConvergenceOptions<TData> = {
  desiredReplicas: number;
  refetch: () => Promise<{ data?: TData }>;
  resolveObservedState: (data: TData | undefined) => ScaleObservedState | null | undefined;
  onRound?: (round: ScaleConvergenceRound) => void;
  initialObservedState?: ScaleObservedState | null;
  onBeforeRefetch?: (attempt: number) => void;
  intervalMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  requireAvailableReplicas?: boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type RunScaleConvergenceResult<TData> = {
  rounds: ScaleConvergenceRound[];
  finalRound: ScaleConvergenceRound;
  lastData?: TData;
};

const DEFAULT_INTERVAL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 60_000;

function defaultNow(): number {
  return Date.now();
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function toSafeInt(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeDesiredReplicas(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.trunc(value));
}

function normalizeObservedState(
  desiredReplicas: number,
  previous: ScaleConvergenceRound["observed"] | null,
  next: ScaleObservedState | null | undefined,
  observedAtFallback: string,
): ScaleConvergenceRound["observed"] {
  const observedReplicas = toSafeInt(next?.observedReplicas ?? previous?.observedReplicas);
  const readyReplicas = toSafeInt(next?.readyReplicas ?? previous?.readyReplicas);
  const availableReplicas = toSafeInt(next?.availableReplicas ?? previous?.availableReplicas);

  return {
    desiredReplicas,
    observedReplicas,
    readyReplicas,
    ...(availableReplicas !== null ? { availableReplicas } : {}),
    ...(typeof next?.observedAt === "string"
      ? { observedAt: next.observedAt }
      : previous?.observedAt
        ? { observedAt: previous.observedAt }
        : { observedAt: observedAtFallback }),
  };
}

function isConverged(observed: ScaleConvergenceRound["observed"], requireAvailableReplicas = false): boolean {
  const desired = observed.desiredReplicas;
  if (observed.observedReplicas !== desired || observed.readyReplicas !== desired) {
    return false;
  }
  if (!requireAvailableReplicas) {
    return true;
  }
  return observed.availableReplicas === desired;
}

function emitRound(
  rounds: ScaleConvergenceRound[],
  onRound: RunScaleConvergenceOptions<unknown>["onRound"],
  round: ScaleConvergenceRound,
): void {
  rounds.push(round);
  if (onRound) {
    onRound(round);
  }
}

export function resolveScaleConvergenceRefetchInterval(
  status: ScaleConvergenceStatus | null | undefined,
  activeIntervalMs = DEFAULT_INTERVAL_MS,
): number | false {
  if (status === "accepted" || status === "converging") {
    return Math.max(250, Math.trunc(activeIntervalMs));
  }
  return false;
}

export async function runScaleConvergence<TData>(
  options: RunScaleConvergenceOptions<TData>,
): Promise<RunScaleConvergenceResult<TData>> {
  const now = options.now ?? defaultNow;
  const sleep = options.sleep ?? defaultSleep;
  const desiredReplicas = normalizeDesiredReplicas(options.desiredReplicas);
  const intervalMs = Math.max(250, Math.trunc(options.intervalMs ?? DEFAULT_INTERVAL_MS));
  const timeoutMs = Math.max(intervalMs, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS));
  const maxAttempts =
    typeof options.maxAttempts === "number" && Number.isFinite(options.maxAttempts) && options.maxAttempts > 0
      ? Math.trunc(options.maxAttempts)
      : Math.max(1, Math.ceil(timeoutMs / intervalMs));

  const startedAt = now();
  const rounds: ScaleConvergenceRound[] = [];
  let lastData: TData | undefined;

  const acceptedObserved = normalizeObservedState(
    desiredReplicas,
    null,
    options.initialObservedState,
    new Date(startedAt).toISOString(),
  );
  const acceptedRound: ScaleConvergenceRound = {
    status: "accepted",
    attempt: 0,
    maxAttempts,
    elapsedMs: 0,
    observed: acceptedObserved,
  };
  emitRound(rounds, options.onRound, acceptedRound);

  let previousObserved = acceptedObserved;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (attempt > 1) {
      await sleep(intervalMs);
    }

    options.onBeforeRefetch?.(attempt);
    const refetchResult = await options.refetch();
    lastData = refetchResult.data;

    const observedPatch = options.resolveObservedState(refetchResult.data);
    const observed = normalizeObservedState(
      desiredReplicas,
      previousObserved,
      observedPatch,
      new Date(now()).toISOString(),
    );

    const elapsedMs = Math.max(0, now() - startedAt);
    const convergingRound: ScaleConvergenceRound = {
      status: "converging",
      attempt,
      maxAttempts,
      elapsedMs,
      observed,
    };
    emitRound(rounds, options.onRound, convergingRound);

    previousObserved = observed;

    if (isConverged(observed, options.requireAvailableReplicas)) {
      const stableRound: ScaleConvergenceRound = {
        ...convergingRound,
        status: "stable",
      };
      emitRound(rounds, options.onRound, stableRound);
      return { rounds, finalRound: stableRound, ...(lastData !== undefined ? { lastData } : {}) };
    }

    if (elapsedMs >= timeoutMs || attempt >= maxAttempts) {
      const timeoutRound: ScaleConvergenceRound = {
        ...convergingRound,
        status: "timeout",
      };
      emitRound(rounds, options.onRound, timeoutRound);
      return { rounds, finalRound: timeoutRound, ...(lastData !== undefined ? { lastData } : {}) };
    }
  }

  const fallbackTimeoutRound: ScaleConvergenceRound = {
    status: "timeout",
    attempt: maxAttempts,
    maxAttempts,
    elapsedMs: Math.max(0, now() - startedAt),
    observed: previousObserved,
  };
  emitRound(rounds, options.onRound, fallbackTimeoutRound);
  return { rounds, finalRound: fallbackTimeoutRound, ...(lastData !== undefined ? { lastData } : {}) };
}
