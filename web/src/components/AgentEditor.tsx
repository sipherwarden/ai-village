import { useEffect, useMemo, useState } from 'react';
import type { Accessory, AgentConfig, AgentState, BodyShape, ExpressionStyle, IntegrationInfo, IntegrationKind, VoiceStyle } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { STATE_LABEL } from '../lib/format.ts';
import { Portrait as Character } from './Avatar.tsx';
import { ARCHETYPES, archetypeOf, extraAccessory } from '../lib/archetype.ts';
import { Markdown, Modal, Segmented } from './ui.tsx';

const COLORS = ['#4C8DFF', '#A47CFF', '#2FC17A', '#FF8A3D', '#FF5C8A', '#22C3E6', '#FFC23D', '#7C8CFF', '#E2556B', '#8BD450'];
const SHAPES: BodyShape[] = ['round', 'squircle', 'drop', 'bean', 'ghost'];
const ACCESSORIES: Accessory[] = ['none', 'antenna', 'headphones', 'glasses', 'beanie', 'bow', 'leaf', 'crown', 'visor', 'scarf'];
const EXPRESSIONS: ExpressionStyle[] = ['friendly', 'focused', 'cheerful', 'sleepy'];
const VOICES: { value: VoiceStyle; label: string }[] = [
  { value: 'curious', label: 'Curious' },
  { value: 'calm', label: 'Calm' },
  { value: 'chatty', label: 'Chatty' },
  { value: 'determined', label: 'Determined' },
  { value: 'neutral', label: 'Neutral' },
];
const PROVIDERS = ['anthropic', 'google', 'openai', 'opencode', 'custom'];
const PREVIEW_STATES: AgentState[] = ['IDLE', 'WORKING', 'THINKING', 'WAITING', 'COMPLETED', 'ERROR', 'OFFLINE'];

const BLANK: AgentConfig = {
  id: '',
  name: '',
  provider: 'custom',
  integration: 'http-push',
  color: '#7C8CFF',
  personality: '',
  voice: 'neutral',
  appearance: { archetype: 'sprite', shape: 'round', accessory: 'none', expression: 'friendly', scale: 1 },
  enabled: true,
  settings: {},
  secretRef: null,
  hasIngestToken: false,
  createdAt: 0,
  sort: 0,
};

export function AgentEditor({ open, agent, onClose }: { open: boolean; agent: AgentConfig | null; onClose: () => void }) {
  const isNew = !agent;
  const [draft, setDraft] = useState<AgentConfig>(agent ?? BLANK);
  const [integrations, setIntegrations] = useState<IntegrationInfo[]>([]);
  const [secretNames, setSecretNames] = useState<string[]>([]);
  const [previewState, setPreviewState] = useState<AgentState>('IDLE');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showDocs, setShowDocs] = useState(false);
  const [newSecret, setNewSecret] = useState({ name: '', value: '' });

  useEffect(() => {
    if (!open) return;
    // Agents saved before 2.0 get their derived design made explicit, so editing keeps the same look.
    setDraft(agent ? { ...agent, appearance: { ...agent.appearance, archetype: archetypeOf(agent.appearance, agent.voice), accessory: extraAccessory(agent.appearance, agent.voice) } } : BLANK);
    setError(null);
    setShowDocs(false);
    void api.get<IntegrationInfo[]>(`/api/integrations${agent ? `?agentId=${agent.id}` : ''}`).then(setIntegrations).catch(() => {});
    void api.get<{ name: string }[]>('/api/secrets').then((s) => setSecretNames(s.map((x) => x.name))).catch(() => {});
  }, [open, agent]);

  const info = useMemo(() => integrations.find((i) => i.kind === draft.integration), [integrations, draft.integration]);
  const set = (patch: Partial<AgentConfig>) => setDraft((d) => ({ ...d, ...patch }));
  const setLook = (patch: Partial<AgentConfig['appearance']>) => setDraft((d) => ({ ...d, appearance: { ...d.appearance, ...patch } }));
  const setSetting = (k: string, v: string | number | boolean) => setDraft((d) => ({ ...d, settings: { ...d.settings, [k]: v } }));

  const chooseIntegration = (kind: IntegrationKind) => {
    const next = integrations.find((i) => i.kind === kind);
    const defaults: Record<string, string | number | boolean> = {};
    for (const f of next?.fields ?? []) if (f.default !== undefined) defaults[f.key] = f.default;
    setDraft((d) => ({ ...d, integration: kind, settings: { ...defaults, ...(kind === agent?.integration ? agent.settings : {}) } }));
  };

  const addSecret = async () => {
    try {
      await api.put(`/api/secrets/${newSecret.name}`, { value: newSecret.value });
      setSecretNames((s) => [...new Set([...s, newSecret.name])]);
      set({ secretRef: newSecret.name });
      setNewSecret({ name: '', value: '' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      if (isNew) await api.post('/api/agents', draft);
      else await api.patch(`/api/agents/${agent!.id}`, draft);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={isNew ? 'Add an agent' : `Customize ${agent?.name}`} width={860}>
      <div className="grid gap-4 p-4 md:grid-cols-[260px_1fr] md:p-5">
        {/* preview */}
        <div className="md:sticky md:top-0 md:self-start">
          <div className={`section grid place-items-center state-${previewState}`} style={{ background: `radial-gradient(circle at 50% 40%, ${draft.color}33, transparent 70%)` }}>
            <Character color={draft.color} appearance={draft.appearance} voice={draft.voice} state={previewState} size={170} seed={2} />
            <div className="mt-1 text-[15px] font-semibold">{draft.name || 'New agent'}</div>
          </div>
          <div className="mt-2 flex flex-wrap justify-center gap-1">
            {PREVIEW_STATES.map((s) => (
              <button key={s} className="chip h-7 text-[11.5px]" style={previewState === s ? { background: 'var(--accent)', color: '#fff' } : undefined} onClick={() => setPreviewState(s)}>
                {STATE_LABEL[s]}
              </button>
            ))}
          </div>
          <p className="mt-2 text-center text-[11.5px] text-ink-3">Preview only. In the village, state comes from real events.</p>
        </div>

        <div className="space-y-4">
          <section className="space-y-3">
            <div className="label">Identity</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[12.5px] text-ink-2">Name</span>
                <input className="field" value={draft.name} maxLength={32} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Research bot" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12.5px] text-ink-2">Provider</span>
                <select className="field" value={PROVIDERS.includes(draft.provider) ? draft.provider : 'custom'} onChange={(e) => set({ provider: e.target.value })}>
                  {PROVIDERS.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
              {isNew && (
                <label className="block sm:col-span-2">
                  <span className="mb-1 block text-[12.5px] text-ink-2">Agent id (used in hook commands and URLs)</span>
                  <input className="field" value={draft.id} placeholder={draft.name ? draft.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'auto from name'} onChange={(e) => set({ id: e.target.value.toLowerCase() })} />
                </label>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <div className="label">Character</div>
            <div className="flex flex-wrap items-center gap-2">
              {COLORS.map((c) => (
                <button key={c} aria-label={`Color ${c}`} className="h-8 w-8 rounded-full border-2 transition-transform hover:scale-110" style={{ background: c, borderColor: draft.color.toLowerCase() === c.toLowerCase() ? 'var(--text)' : 'transparent' }} onClick={() => set({ color: c })} />
              ))}
              <label className="relative h-8 w-8 overflow-hidden rounded-full border border-line" title="Custom color" style={{ background: 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
                <input type="color" className="absolute inset-0 opacity-0" value={draft.color} onChange={(e) => set({ color: e.target.value })} />
              </label>
            </div>
            <div>
              <span className="mb-1.5 block text-[12.5px] text-ink-2">Character design (also sets the workstation)</span>
              <div className="grid grid-cols-5 gap-1.5">
                {ARCHETYPES.map((t) => {
                  const on = archetypeOf(draft.appearance, draft.voice) === t.value;
                  return (
                    <button
                      key={t.value}
                      title={`${t.blurb}. Workstation: ${t.station}.`}
                      className="flex flex-col items-center rounded-[14px] border px-1 pb-1.5 pt-1 transition-colors"
                      style={{ borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'color-mix(in srgb, var(--accent) 14%, transparent)' : 'var(--glass)' }}
                      onClick={() => setLook({ archetype: t.value, accessory: 'none' })}
                    >
                      <Character color={draft.color} appearance={{ ...draft.appearance, archetype: t.value, accessory: 'none' }} voice={draft.voice} state="IDLE" size={58} still />
                      <span className="mt-0.5 text-[11.5px] font-semibold">{t.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {archetypeOf(draft.appearance, draft.voice) === 'sprite' && (
              <div>
                <span className="mb-1 block text-[12.5px] text-ink-2">Body</span>
                <Segmented value={draft.appearance.shape} options={SHAPES.map((s) => ({ value: s, label: s }))} onChange={(v) => setLook({ shape: v })} />
              </div>
            )}
            <div>
              <span className="mb-1 block text-[12.5px] text-ink-2">Extra accessory</span>
              <Segmented value={draft.appearance.accessory} options={ACCESSORIES.map((s) => ({ value: s, label: s }))} onChange={(v) => setLook({ accessory: v })} />
            </div>
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <span className="mb-1 block text-[12.5px] text-ink-2">Expression</span>
                <Segmented value={draft.appearance.expression} options={EXPRESSIONS.map((s) => ({ value: s, label: s }))} onChange={(v) => setLook({ expression: v })} />
              </div>
              <label className="block min-w-[160px] flex-1">
                <span className="mb-1 block text-[12.5px] text-ink-2">Size · {Math.round(draft.appearance.scale * 100)}%</span>
                <input type="range" min={0.8} max={1.3} step={0.05} value={draft.appearance.scale} onChange={(e) => setLook({ scale: Number(e.target.value) })} className="w-full accent-[var(--accent)]" />
              </label>
            </div>
          </section>

          <section className="space-y-3">
            <div className="label">Personality</div>
            <textarea className="field" rows={2} maxLength={300} value={draft.personality} onChange={(e) => set({ personality: e.target.value })} placeholder="How would you describe this agent?" />
            <div>
              <span className="mb-1 block text-[12.5px] text-ink-2">Speech style (changes phrasing only, never the facts)</span>
              <Segmented value={draft.voice} options={VOICES} onChange={(v) => set({ voice: v })} />
            </div>
          </section>

          <section className="space-y-3">
            <div className="label">Integration</div>
            <select className="field" value={draft.integration} onChange={(e) => chooseIntegration(e.target.value as IntegrationKind)}>
              {integrations.map((i) => (
                <option key={i.kind} value={i.kind}>
                  {i.label}
                </option>
              ))}
            </select>
            {info && (
              <div className="section !py-3">
                <p className="text-[13px] text-ink-2">{info.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {info.capabilities.map((c) => (
                    <span key={c.key} className="chip h-6 text-[11.5px]" title={c.note}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: c.level === 'live' ? 'var(--st-online)' : c.level === 'partial' ? 'var(--st-waiting)' : 'var(--st-offline)' }} />
                      {c.label}
                    </span>
                  ))}
                </div>
                <button className="mt-2 text-[12.5px] font-medium text-accent" onClick={() => setShowDocs((s) => !s)}>
                  {showDocs ? 'Hide setup guide' : 'View setup guide'}
                </button>
                {showDocs && (
                  <div className="mt-1">
                    <Markdown text={info.docs} />
                  </div>
                )}
              </div>
            )}
            {info?.fields.map((f) => (
              <label key={f.key} className={f.type === 'boolean' ? 'flex items-center gap-2' : 'block'}>
                {f.type === 'boolean' ? (
                  <>
                    <input type="checkbox" checked={!!draft.settings[f.key]} onChange={(e) => setSetting(f.key, e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
                    <span className="text-[13.5px]">{f.label}</span>
                  </>
                ) : (
                  <>
                    <span className="mb-1 block text-[12.5px] text-ink-2">{f.label}</span>
                    <input
                      className="field"
                      type={f.type === 'number' ? 'number' : 'text'}
                      placeholder={f.placeholder}
                      value={String(draft.settings[f.key] ?? f.default ?? '')}
                      onChange={(e) => setSetting(f.key, f.type === 'number' ? Number(e.target.value) : e.target.value)}
                    />
                    {f.help && <span className="mt-1 block text-[12px] text-ink-3">{f.help}</span>}
                  </>
                )}
              </label>
            ))}
            {(info?.usesSecret || draft.secretRef) && (
              <div className="space-y-2">
                <label className="block">
                  <span className="mb-1 block text-[12.5px] text-ink-2">Credential (stored encrypted on this computer, never sent to the browser)</span>
                  <select className="field" value={draft.secretRef ?? ''} onChange={(e) => set({ secretRef: e.target.value || null })}>
                    <option value="">None</option>
                    {secretNames.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-2">
                  <input className="field w-[38%]" placeholder="new-secret-name" value={newSecret.name} onChange={(e) => setNewSecret((s) => ({ ...s, name: e.target.value.toLowerCase() }))} />
                  <input className="field flex-1" type="password" placeholder="value" autoComplete="off" value={newSecret.value} onChange={(e) => setNewSecret((s) => ({ ...s, value: e.target.value }))} />
                  <button className="btn" disabled={!newSecret.name || !newSecret.value} onClick={() => void addSecret()}>
                    Store
                  </button>
                </div>
              </div>
            )}
          </section>

          {error && <p className="rounded-xl bg-[var(--st-error)]/15 px-3 py-2 text-[13px] text-[var(--st-error)]">{error}</p>}
          <div className="flex justify-end gap-2 border-t border-line pt-3">
            <button className="btn" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" disabled={saving || !draft.name} onClick={() => void save()}>
              {saving ? 'Saving…' : isNew ? 'Add agent' : 'Save changes'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
