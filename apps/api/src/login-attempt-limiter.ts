export const loginAttemptLimit = 5;
export const loginAttemptWindowMs = 15 * 60 * 1_000;

export interface LoginAttemptLimiter {
  getRetryAfterSeconds: () => number | null;
  recordFailure: () => void;
  reset: () => void;
}

export interface CreateLoginAttemptLimiterOptions {
  now?: () => Date;
}

export const createLoginAttemptLimiter = (
  options: CreateLoginAttemptLimiterOptions = {},
): LoginAttemptLimiter => {
  const now = options.now ?? (() => new Date());
  const failures: number[] = [];

  const discardExpiredFailures = (currentTime: number) => {
    const earliestAcceptedFailure = currentTime - loginAttemptWindowMs;

    while (
      failures[0] !== undefined &&
      failures[0] <= earliestAcceptedFailure
    ) {
      failures.shift();
    }
  };

  return {
    getRetryAfterSeconds: () => {
      const currentTime = now().getTime();
      discardExpiredFailures(currentTime);

      if (failures.length < loginAttemptLimit) {
        return null;
      }

      return Math.ceil(
        (failures[0]! + loginAttemptWindowMs - currentTime) / 1_000,
      );
    },
    recordFailure: () => {
      const currentTime = now().getTime();
      discardExpiredFailures(currentTime);
      failures.push(currentTime);
    },
    reset: () => {
      failures.length = 0;
    },
  };
};
