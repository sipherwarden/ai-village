// Provider availability. This is deliberately separate from agent activity: a provider being up says
// nothing about whether one of your agents is doing anything.

import type { AgentConfig, ProviderHealth } from '../shared/types.ts';
import type { Secrets } from './secrets.ts';

const STATUSPAGES: Record<string, string[]> = {
  anthropic: ['https://status.claude.com/api/v2/status.json', 'https://status.anthropic.com/api/v2/status.json'],
  openai: ['https://status.openai.com/api/v2/status.json'],
};

async function statuspage(urls: string[]): Promise<ProviderHealth> {
  for (const url of urls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000), headers: { accept: 'application/json' } });
      if (!res.ok) continue;
      const body = (await res.json()) as { status?: { indicator?: string; description?: string } };
      const ind = body.status?.indicator;
      if (!ind) continue;
      return {
        status: ind === 'none' ? 'operational' : ind === 'minor' ? 'degraded' : ind === 'maintenance' ? 'degraded' : 'outage',
        detail: body.status?.description ?? ind,
        checkedAt: Date.now(),
        source: new URL(url).hostname,
      };
    } catch {
      /* try next */
    }
  }
  return { status: 'unknown', detail: 'The public status page could not be read.', checkedAt: Date.now(), source: null };
}

async function validateKey(provider: string, key: string): Promise<ProviderHealth> {
  try {
    let res: Response;
    if (provider === 'google') {
      res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': key },
        signal: AbortSignal.timeout(8000),
      });
    } else if (provider === 'anthropic') {
      res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(8000),
      });
    } else if (provider === 'openai') {
      res = await fetch('https://api.openai.com/v1/models', { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    } else {
      return { status: 'unknown', detail: 'No key check available for this provider.', checkedAt: Date.now(), source: null };
    }
    const host = new URL(res.url).hostname;
    if (res.ok) return { status: 'operational', detail: 'API reachable and the stored key was accepted.', checkedAt: Date.now(), source: host };
    if (res.status === 401 || res.status === 403)
      return { status: 'outage', detail: `API reachable but the stored key was rejected (HTTP ${res.status}).`, checkedAt: Date.now(), source: host };
    return { status: res.status >= 500 ? 'outage' : 'degraded', detail: `API answered HTTP ${res.status}.`, checkedAt: Date.now(), source: host };
  } catch (e) {
    return { status: 'unknown', detail: `Couldn't reach the API: ${(e as Error).message}`, checkedAt: Date.now(), source: null };
  }
}

/** Checks one agent's provider. Key checks only run if the agent explicitly opts in. */
export async function checkProvider(agent: AgentConfig, secrets: Secrets, allowKeyCheck: boolean): Promise<ProviderHealth> {
  const p = agent.provider.toLowerCase();
  if (allowKeyCheck && agent.settings.validateKey && agent.secretRef) {
    const key = await secrets.get(agent.secretRef).catch(() => null);
    if (key) return validateKey(p, key);
  }
  if (STATUSPAGES[p]) return statuspage(STATUSPAGES[p]);
  if (p === 'google')
    return {
      status: 'unknown',
      detail: "Google doesn't publish a machine-readable Gemini status feed. Turn on key validation to check the API directly.",
      checkedAt: Date.now(),
      source: null,
    };
  return { status: 'not-checked', detail: 'No provider status source for this agent.', checkedAt: null, source: null };
}
