import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { Button, Field, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { GlassPanel } from '../components/marketing';
import { Atmosphere, Parallax, Reveal } from '../lib/motion';

/**
 * Auth shell.
 *
 * The form logic is unchanged — this is the same split layout with the visual
 * language rebuilt: a lit environment on the left, a floating glass document on
 * the right, and motion that responds to the pointer rather than decoration.
 */
function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle: string; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <div className="relative grid min-h-screen overflow-x-clip bg-void lg:grid-cols-[1.05fr_0.95fr]">
      {/* Environment */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <Atmosphere intensity={1.1} />
      </div>

      {/* Left: the scene */}
      <div className="relative hidden overflow-hidden lg:block">
        <div className="absolute inset-0 flex flex-col justify-between p-12">
          <Link to="/" className="flex w-fit items-center gap-2.5" data-cursor="Home">
            <ShieldCheck size={20} className="text-iris" />
            <span className="text-sm font-semibold tracking-tight">CRA Compliance OS</span>
          </Link>

          <div className="max-w-md">
            <Reveal>
              <h2 className="display text-display-3">
                Turn your repositories into <span className="ink-gradient">CRA evidence</span>
              </h2>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-6 text-sm leading-relaxed text-muted">
                Connect a repository and get a CycloneDX SBOM, matched CVEs with KEV and EPSS
                signals, an explainable readiness score, and Article 14 report drafts — from live
                data, not a questionnaire.
              </p>
            </Reveal>

            <ul className="mt-9 space-y-3.5">
              {[
                'Real SBOM from npm, PyPI, Go, Maven, Cargo, Composer, NuGet and Ruby',
                'Every score has written rationale you can hand to an auditor',
                'Article 14 clocks: 24 hours, 72 hours, 14 days',
                'Prepaid credits. No seat licences, no annual lock-in.',
              ].map((item, index) => (
                <Reveal key={item} delay={200 + index * 90}>
                  <li className="flex gap-3 text-sm leading-relaxed text-muted">
                    <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-iris" />
                    {item}
                  </li>
                </Reveal>
              ))}
            </ul>
          </div>

          <Reveal delay={520}>
            <p className="text-xs text-faint">Engineering evidence tooling. Not legal advice.</p>
          </Reveal>
        </div>

        {/* Floating object: the output, not a screenshot of a dashboard. */}
        <div className="pointer-events-none absolute -right-16 top-1/2 hidden w-72 -translate-y-1/2 xl:block">
          <Parallax speed={0.05}>
            <GlassPanel strong className="animate-float-slow p-5">
              <p className="eyebrow">Readiness</p>
              <p className="mt-2 flex items-baseline gap-2">
                <span className="text-3xl font-semibold tracking-tight">74</span>
                <span className="text-xs text-partial">· B</span>
              </p>
              <div className="mt-4 space-y-1.5 text-[11px]">
                {[
                  ['cra.sbom.present', 'met', 'text-pass'],
                  ['cra.vuln.monitoring', 'met', 'text-pass'],
                  ['cra.incident.process', 'partial', 'text-partial'],
                  ['cra.gov.pen_test', 'gap', 'text-fail'],
                ].map(([id, status, tone]) => (
                  <div key={id} className="flex items-center justify-between gap-3">
                    <span className="truncate text-faint">{id}</span>
                    <span className={`shrink-0 font-medium ${tone}`}>{status}</span>
                  </div>
                ))}
              </div>
            </GlassPanel>
          </Parallax>
        </div>
      </div>

      {/* Right: the form, as a floating document */}
      <div className="grid place-items-center px-5 py-14 sm:px-8">
        <div className="w-full max-w-sm">
          <Link to="/" className="mb-10 flex items-center gap-2.5 lg:hidden">
            <ShieldCheck size={20} className="text-iris" />
            <span className="text-sm font-semibold">CRA Compliance OS</span>
          </Link>

          <Reveal>
            <h1 className="display text-2xl tracking-tight sm:text-3xl">{title}</h1>
          </Reveal>
          <Reveal delay={80}>
            <p className="mt-2.5 text-sm text-muted">{subtitle}</p>
          </Reveal>

          <Reveal delay={140}>
            <GlassPanel strong className="mt-8 p-6">
              {children}
            </GlassPanel>
          </Reveal>

          <Reveal delay={220}>
            <div className="mt-6 text-center text-xs text-muted">{footer}</div>
          </Reveal>
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      navigate('/app');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Sign in"
      subtitle="Continue to your compliance workspace."
      footer={
        <>
          No account yet?{' '}
          <Link to="/signup" className="text-accent hover:underline">
            Create one — 250 credits free
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-fail/30 bg-fail/5 px-3 py-2 text-xs text-fail">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <Field label="Email">
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            required
            autoFocus
          />
        </Field>

        <Field label="Password">
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="current-password"
            required
          />
        </Field>

        <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<ArrowRight size={14} />}>
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}

export function Signup() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      setError('Use at least 8 characters for your password.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await signUp(email.trim(), password, name.trim() || undefined);
      navigate('/app/onboarding');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create your account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="100 free credits. No card required."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg border border-fail/30 bg-fail/5 px-3 py-2 text-xs text-fail">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            {error}
          </div>
        ) : null}

        <Field label="Name" hint="Optional">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ada Lovelace" autoComplete="name" />
        </Field>

        <Field label="Work email" required>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
            required
            autoFocus
          />
        </Field>

        <Field label="Password" hint="At least 8 characters" required>
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            autoComplete="new-password"
            required
          />
        </Field>

        <Button type="submit" variant="primary" className="w-full" loading={busy} icon={<ArrowRight size={14} />}>
          Create account
        </Button>

        <p className="text-center text-[11px] leading-relaxed text-faint">
          By continuing you agree to the{' '}
          <Link to="/legal/terms" className="underline hover:text-muted">
            Terms
          </Link>{' '}
          and{' '}
          <Link to="/legal/privacy" className="underline hover:text-muted">
            Privacy Policy
          </Link>
          .
        </p>
      </form>
    </AuthShell>
  );
}
