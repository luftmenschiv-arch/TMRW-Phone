export const SOCIAL_RUNTIME_POLICY = Object.freeze({
  projectionEnabled: true,
  uiEnabledByDefault: false,
  autonomousJobsEnabled: false,
  backgroundPollingEnabled: false,
});

export function socialRuntimeState(overrides = {}) {
  return Object.freeze({ ...SOCIAL_RUNTIME_POLICY, ...overrides, autonomousJobsEnabled: false, backgroundPollingEnabled: false });
}
