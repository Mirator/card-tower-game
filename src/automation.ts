export function shouldExposeAutomationHooks(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_EXPOSE_TEST_HOOKS === 'true';
}
