import type { Scenario } from './types.js';

export interface ScenarioSpec {
  scenario: Scenario;
  /** Item present at start that is removed by the trigger. */
  oldItem: string;
  /** Item added by the trigger. */
  newItem: string;
  listMethod: string;
  notificationMethod: string;
  useMethod: string;
}

export const SCENARIOS: Record<Scenario, ScenarioSpec> = {
  tools: {
    scenario: 'tools',
    oldItem: 'probe_old',
    newItem: 'probe_new',
    listMethod: 'tools/list',
    notificationMethod: 'notifications/tools/list_changed',
    useMethod: 'tools/call',
  },
  prompts: {
    scenario: 'prompts',
    oldItem: 'probe_prompt_old',
    newItem: 'probe_prompt_new',
    listMethod: 'prompts/list',
    notificationMethod: 'notifications/prompts/list_changed',
    useMethod: 'prompts/get',
  },
  resources: {
    scenario: 'resources',
    oldItem: 'probe://old',
    newItem: 'probe://new',
    listMethod: 'resources/list',
    notificationMethod: 'notifications/resources/list_changed',
    useMethod: 'resources/read',
  },
};

export const ALL_SCENARIOS: Scenario[] = ['tools', 'prompts', 'resources'];

/** Name of the always-present tool that triggers the change. */
export const TRIGGER_TOOL = 'probe_add';

export function parseScenarios(value: string): Scenario[] {
  if (value === 'all') return [...ALL_SCENARIOS];
  if (value === 'tools' || value === 'prompts' || value === 'resources') return [value];
  throw new Error(`Unknown scenario "${value}". Use one of: tools, prompts, resources, all.`);
}
