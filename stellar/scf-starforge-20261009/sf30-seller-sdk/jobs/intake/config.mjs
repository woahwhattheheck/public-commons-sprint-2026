// MIT. Merchant selects the public input functions; customers cannot supply a handler or price.
import { object, need } from './protocol.mjs';

export function compileJobIntake(input, functions) {
  if (input === undefined) return Object.freeze({ enabled: false });
  need(object(input) && Object.keys(input).every(key =>
    ['enabled', 'functions', 'accessTokenEnvironment'].includes(key)) && typeof input.enabled === 'boolean',
    'JOB_INTAKE_CONFIG_INVALID');
  if (!input.enabled) {
    need(input.functions === undefined && input.accessTokenEnvironment === undefined,
      'JOB_INTAKE_DISABLED_CONFIG_INVALID');
    return Object.freeze({ enabled: false });
  }
  need(Array.isArray(input.functions) && input.functions.length > 0 && input.functions.length <= 64 &&
    new Set(input.functions).size === input.functions.length &&
    input.functions.every(id => typeof id === 'string' && Object.hasOwn(functions, id)),
    'JOB_INTAKE_CONFIG_FUNCTIONS_REQUIRED');
  const environment = input.accessTokenEnvironment ?? null;
  need(environment === null || typeof environment === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(environment),
    'JOB_INTAKE_ACCESS_ENVIRONMENT_INVALID');
  return Object.freeze({ enabled: true, functions: Object.freeze([...input.functions]),
    accessTokenEnvironment: environment });
}
