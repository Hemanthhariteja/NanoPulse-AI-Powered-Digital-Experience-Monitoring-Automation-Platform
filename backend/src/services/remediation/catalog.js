import { z } from 'zod';

/**
 * Allowlist of remediation actions. The backend only ever sends an action *name* plus
 * validated parameters; the agent maps the name to its own built-in handler.
 * No shell command, path or executable is ever transmitted.
 * Keep in sync with agent/nanopulse_agent/actions.py.
 */
export const ACTIONS = {
  list_top_cpu_processes: {
    label: 'Identify high-CPU processes',
    description: 'Samples running processes and reports the top CPU consumers. Read-only.',
    riskLevel: 'low',
    readOnly: true,
    timeoutSeconds: 30,
    requires: null,
    params: z.object({ limit: z.number().int().min(1).max(25).default(10) }).strict(),
  },
  list_top_memory_processes: {
    label: 'Identify memory-intensive processes',
    description: 'Reports processes with the largest resident memory. Read-only.',
    riskLevel: 'low',
    readOnly: true,
    timeoutSeconds: 30,
    requires: null,
    params: z.object({ limit: z.number().int().min(1).max(25).default(10) }).strict(),
  },
  check_network_connectivity: {
    label: 'Check network connectivity',
    description: "TCP and DNS probes to the agent's configured hosts. Read-only.",
    riskLevel: 'low',
    readOnly: true,
    timeoutSeconds: 45,
    requires: null,
    params: z.object({}).strict(),
  },
  network_diagnostics: {
    label: 'Generate network diagnostics',
    description: 'Collects interfaces, addresses, link state, I/O counters and a connection summary. Read-only.',
    riskLevel: 'low',
    readOnly: true,
    timeoutSeconds: 45,
    requires: null,
    params: z.object({}).strict(),
  },
  clear_temp_files: {
    label: 'Clear eligible temporary files',
    description:
      "Deletes files older than the given age, only inside the agent's designated safe temp directory. Never touches user documents.",
    riskLevel: 'medium',
    readOnly: false,
    timeoutSeconds: 120,
    requires: 'safeTempDir',
    params: z
      .object({
        olderThanHours: z.number().int().min(0).max(720).default(24),
        dryRun: z.boolean().default(false),
      })
      .strict(),
  },
  restart_demo_app: {
    label: 'Restart configured demo application',
    description:
      'Stops and restarts only the application explicitly configured in the agent (matched by its command-line marker).',
    riskLevel: 'medium',
    readOnly: false,
    timeoutSeconds: 60,
    requires: 'demoApp',
    params: z.object({}).strict(),
  },
};

export const ACTION_TYPES = Object.keys(ACTIONS);

export function publicCatalog() {
  return ACTION_TYPES.map((type) => {
    const { params: _p, ...rest } = ACTIONS[type];
    return { type, ...rest };
  });
}

/** Returns parsed params or throws a descriptive Error. */
export function validateParams(actionType, params = {}) {
  const action = ACTIONS[actionType];
  if (!action) throw new Error(`Unknown action "${actionType}"`);
  const result = action.params.safeParse(params ?? {});
  if (!result.success) throw new Error(`Invalid parameters: ${result.error.issues[0].message}`);
  return result.data;
}

export function deviceSupports(device, actionType) {
  const action = ACTIONS[actionType];
  if (!action) return false;
  if (device.agentType === 'simulated' || !action.requires) return true;
  return Boolean(device.capabilities?.[action.requires]);
}
