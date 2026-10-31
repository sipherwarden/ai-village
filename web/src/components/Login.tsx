import { useState, type FormEvent } from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api.ts';
import { store, type AuthState } from '../lib/store.ts';
import { Portrait as Character } from './Avatar.tsx';

export function Login({ mode }: { mode: AuthState }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setup = mode === 'setup';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (setup && pw !== pw2) return setError('Passwords don’t match.');
    setBusy(true);
    try {
      await api.post(setup ? '/api/auth/setup' : '/api/auth/login', { password: pw });
      await store.signedIn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative z-10 grid h-full place-items-center p-4">
      <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} className="glass w-full max-w-[400px] rounded-[28px] p-7">
        <div className="mb-3 flex justify-center gap-1">
          {(['#4C8DFF', '#A47CFF', '#2FC17A', '#FF8A3D'] as const).map((c, i) => (
            <div key={c} className="state-IDLE">
              <Character color={c} appearance={{ archetype: (['explorer', 'scholar', 'host', 'builder'] as const)[i], shape: 'round', accessory: 'none', expression: 'friendly', scale: 1 }} voice="neutral" state={mode === 'setup-remote' ? 'OFFLINE' : 'IDLE'} size={70} seed={i * 2} />
            </div>
          ))}
        </div>
        <h1 className="text-center font-display text-[26px] font-bold tracking-tight">AI Village</h1>
        {mode === 'setup-remote' ? (
          <p className="mt-3 text-center text-[14px] leading-relaxed text-ink-2">
            Finish setup on the PC running AI Village first. Open <b>http://localhost:7777</b> there and create a password, then sign in here.
          </p>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3">
            <p className="text-center text-[13.5px] text-ink-2">{setup ? 'Create a password. You’ll use it on your iPad and other devices.' : 'Sign in to see your agents.'}</p>
            <input className="field h-11" type="password" autoFocus autoComplete={setup ? 'new-password' : 'current-password'} placeholder={setup ? 'New password (8+ characters)' : 'Password'} value={pw} onChange={(e) => setPw(e.target.value)} />
            {setup && <input className="field h-11" type="password" autoComplete="new-password" placeholder="Repeat password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
            {error && <p className="text-center text-[13px] text-[var(--st-error)]">{error}</p>}
            <button className="btn btn-primary h-11 w-full" disabled={busy || !pw}>
              {busy ? '…' : setup ? 'Create password' : 'Sign in'}
            </button>
          </form>
        )}
        <p className="mt-4 text-center text-[11.5px] text-ink-3">Local-first. Only reachable from your private network.</p>
      </motion.div>
    </div>
  );
}
