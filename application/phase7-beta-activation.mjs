export function createPhase7BetaActivation({ createShell, target }) {
  if (typeof createShell !== 'function' || !target) throw new TypeError('Phase 7 activation requires a shell factory and mount target');
  return async ({ resources }) => {
    const shell = await createShell();
    await shell.mount(target);
    resources.add('other', 'phase7-phone-shell', () => shell.dispose());
    return shell;
  };
}
