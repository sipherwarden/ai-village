import { useEffect, useState } from 'react';
import { KeyRound, LogOut, Settings, Trash2 } from 'lucide-react';
import type { HubSettings, Preferences } from '../../../shared/types.ts';
import { api } from '../lib/api.ts';
import { store, useStore } from '../lib/store.ts';
import { Segmented, Sheet, Toggle } from './ui.tsx';

export function SettingsView({ open, onClose }: { open: boolean; onClose: () => void }) {
  const prefs = useStore((s) => s.prefs);
  const hub = useStore((s) => s.snapshot?.hub);
  const [secrets, setSecrets] = useState<{ name: string; usedBy: string[] }[]>([]);
  const [newSecret, setNewSecret] = useState({ name: '', value: '' });
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState<Record<string, string>>({});

  const loadSecrets = () => api.get<{ name: string; usedBy: string[] }[]>('/api/secrets').then(setSecrets).catch(() => {});
  useEffect(() => {
    if (open) void loadSecrets();
  }, [open]);

  const p = (patch: Partial<Preferences>) => void store.savePrefs(patch);
  const h = async (patch: Partial<HubSettings>) => {
    try {
      await api.put('/api/hub', patch);
    } catch (e) {
      setMsg((m) => ({ ...m, hub: (e as Error).message }));
    }
  };
  const note = (k: string, v: string) => setMsg((m) => ({ ...m, [k]: v }));

  const canNotify = typeof Notification !== 'undefined' && window.isSecureContext;

  return (
    <Sheet open={open} onClose={onClose} title="Settings" icon={<Settings size={17} />} width={480}>
      <div className="space-y-3 p-4">
        <section className="section">
          <div className="label mb-2">Appearance</div>
          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-[12.5px] text-ink-2">Panels and controls</span>
              <Segmented value={prefs.theme} onChange={(v) => p({ theme: v })} options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }, { value: 'auto', label: 'Auto' }]} />
            </div>
            <div className="flex items-center gap-3 rounded-[12px] bg-glass-2 p-3">
              <span className="h-10 w-14 flex-none rounded-[6px]" style={{ background: 'linear-gradient(180deg, var(--sky-0), var(--sky-2))', boxShadow: 'inset 0 0 0 3px var(--frame)' }} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block text-[13.5px] font-semibold">Studio</span>
                <span className="block text-[12px] text-ink-3">A workspace with one desk per agent. The window view follows the time of day below.</span>
              </span>
            </div>
            <div>
              <span className="mb-1 block text-[12.5px] text-ink-2">Time of day</span>
              <Segmented
                value={prefs.lighting ?? (prefs.dayNight ? 'auto' : 'night')}
                onChange={(v) => p({ lighting: v, dayNight: v === 'auto' })}
                options={[
                  { value: 'auto', label: 'Follow clock' },
                  { value: 'dawn', label: 'Dawn' },
                  { value: 'day', label: 'Day' },
                  { value: 'dusk', label: 'Dusk' },
                  { value: 'night', label: 'Night' },
                ]}
              />
            </div>
          </div>
          <Toggle checked={prefs.dock !== false} onChange={(v) => p({ dock: v })} label="Activity bar" hint="The latest real event and the last hour, along the bottom of the studio." />
          <Toggle checked={prefs.reduceMotion} onChange={(v) => p({ reduceMotion: v })} label="Reduce motion" hint="Characters stay in place. States still change. Saves battery." />
          <Toggle checked={prefs.bubbles} onChange={(v) => p({ bubbles: v })} label="Event captions" hint="A short line under an agent's name when a real event happens." />
          <Toggle checked={prefs.sound} onChange={(v) => p({ sound: v })} label="Sound effects" hint="A soft chime per agent for finished, waiting and error events." />
        </section>

        <section className="section">
          <div className="label mb-1">Notifications</div>
          <Toggle checked={prefs.notifyOn.waiting} onChange={(v) => p({ notifyOn: { ...prefs.notifyOn, waiting: v } })} label="An agent is waiting for me" />
          <Toggle checked={prefs.notifyOn.error} onChange={(v) => p({ notifyOn: { ...prefs.notifyOn, error: v } })} label="Errors and failed tasks" />
          <Toggle checked={prefs.notifyOn.completed} onChange={(v) => p({ notifyOn: { ...prefs.notifyOn, completed: v } })} label="Finished tasks" />
          <p className="mt-1 text-[12px] text-ink-3">
            {canNotify ? (
              <button className="font-medium text-accent" onClick={() => void Notification.requestPermission().then((r) => note('notify', `Browser notifications: ${r}`))}>
                Also allow system notifications
              </button>
            ) : (
              'In-app banners only. System notifications need HTTPS, which this local connection doesn’t use.'
            )}
            {msg.notify && <span className="ml-1">{msg.notify}</span>}
          </p>
        </section>

        {hub && (
          <section className="section">
            <div className="label mb-1">Monitoring</div>
            <Toggle
              checked={hub.demoMode}
              onChange={(v) => void h({ demoMode: v })}
              label="Demonstration mode"
              hint="Shows simulated activity so you can try the visuals. Clearly labeled everywhere, kept apart from real data, and deleted when you turn it off."
            />
            <Toggle checked={hub.captureDetails} onChange={(v) => void h({ captureDetails: v })} label="Show tool details" hint="File names, command descriptions and search queries. Command arguments and file contents are never collected." />
            <Toggle checked={hub.promptPreviews} onChange={(v) => void h({ promptPreviews: v })} label="Use prompt previews as task titles" hint="Keeps the first 80 characters of each prompt, on this PC only. Off: tasks are titled by project." />
            <Toggle checked={hub.providerChecks} onChange={(v) => void h({ providerChecks: v })} label="Check provider status pages" hint="Every 10 minutes. Sends no data about you or your agents." />
            <div className="grid grid-cols-2 gap-3 pt-2">
              <label className="block">
                <span className="mb-1 block text-[12.5px] text-ink-2">Quiet session timeout (min)</span>
                <input className="field" type="number" min={5} max={1440} defaultValue={hub.sessionTimeoutMin} onBlur={(e) => void h({ sessionTimeoutMin: Number(e.target.value) })} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[12.5px] text-ink-2">Keep history (days)</span>
                <input className="field" type="number" min={1} max={365} defaultValue={hub.retentionDays} onBlur={(e) => void h({ retentionDays: Number(e.target.value) })} />
              </label>
            </div>
            <p className="mt-2 text-[12px] text-ink-3">Hook integrations only report when something happens. A session with no events for this long is treated as closed.</p>
            {msg.hub && <p className="text-[12.5px] text-[var(--st-error)]">{msg.hub}</p>}
          </section>
        )}

        <section className="section">
          <div className="label mb-1">Stored credentials</div>
          <p className="mb-2 text-[12px] text-ink-3">Encrypted on this computer, readable only by the account running the hub (Windows DPAPI, or AES-256-GCM with an owner-only key on macOS and Linux). Values never leave the PC or reach this page.</p>
          {secrets.map((s) => (
            <div key={s.name} className="flex items-center gap-2 border-t border-line py-2 first:border-t-0">
              <KeyRound size={14} className="text-ink-3" />
              <span className="flex-1 text-[13.5px] font-medium">{s.name}</span>
              <span className="text-[12px] text-ink-3">{s.usedBy.length ? `used by ${s.usedBy.join(', ')}` : 'unused'}</span>
              <button
                className="icon-btn h-8 w-8"
                aria-label={`Delete ${s.name}`}
                onClick={async () => {
                  if (!confirm(`Delete the stored secret "${s.name}"?`)) return;
                  try {
                    await api.del(`/api/secrets/${s.name}`);
                    void loadSecrets();
                  } catch (e) {
                    note('secret', (e as Error).message);
                  }
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <div className="mt-2 flex gap-2">
            <input className="field w-[38%]" placeholder="name" value={newSecret.name} onChange={(e) => setNewSecret((s) => ({ ...s, name: e.target.value.toLowerCase() }))} />
            <input className="field flex-1" type="password" autoComplete="off" placeholder="value (replaces existing)" value={newSecret.value} onChange={(e) => setNewSecret((s) => ({ ...s, value: e.target.value }))} />
            <button
              className="btn"
              disabled={!newSecret.name || !newSecret.value}
              onClick={async () => {
                try {
                  await api.put(`/api/secrets/${newSecret.name}`, { value: newSecret.value });
                  setNewSecret({ name: '', value: '' });
                  note('secret', 'Stored.');
                  void loadSecrets();
                } catch (e) {
                  note('secret', (e as Error).message);
                }
              }}
            >
              Store
            </button>
          </div>
          {msg.secret && <p className="mt-1 text-[12.5px] text-ink-2">{msg.secret}</p>}
        </section>

        <section className="section">
          <div className="label mb-2">Security</div>
          <div className="grid grid-cols-2 gap-2">
            <input className="field" type="password" placeholder="Current password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((s) => ({ ...s, current: e.target.value }))} />
            <input className="field" type="password" placeholder="New password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((s) => ({ ...s, next: e.target.value }))} />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              className="btn flex-1"
              disabled={!pw.current || pw.next.length < 8}
              onClick={async () => {
                try {
                  await api.post('/api/auth/password', pw);
                  setPw({ current: '', next: '' });
                  note('pw', 'Password changed. Other devices were signed out.');
                } catch (e) {
                  note('pw', (e as Error).message);
                }
              }}
            >
              Change password
            </button>
            <button
              className="btn"
              onClick={async () => {
                await api.post('/api/auth/logout');
                store.signedOut();
              }}
            >
              <LogOut size={15} /> Sign out
            </button>
          </div>
          {msg.pw && <p className="mt-1 text-[12.5px] text-ink-2">{msg.pw}</p>}
          <p className="mt-2 text-[12px] text-ink-3">The hub only accepts connections from your private network. Open it on your iPad at the address printed when the hub starts.</p>
        </section>

        <p className="pb-3 text-center text-[11.5px] text-ink-3">AI Village · local-first · never shows activity it did not receive</p>
      </div>
    </Sheet>
  );
}
