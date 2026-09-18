import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { AlertTriangle, Check, ChevronDown, Info, Loader2, X, XCircle } from 'lucide-react';
import { cx } from '../lib/format';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-[#0A0B0F] hover:bg-accent-hover font-semibold border-transparent',
  secondary: 'bg-surface-2 text-text hover:bg-surface-3 border-border',
  ghost: 'bg-transparent text-muted hover:text-text hover:bg-surface-2 border-transparent',
  danger: 'bg-fail/10 text-fail hover:bg-fail/20 border-fail/30',
  success: 'bg-pass/10 text-pass hover:bg-pass/20 border-pass/30',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-xs gap-1.5 rounded-md',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-sm gap-2 rounded-lg',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  icon,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center border transition-colors whitespace-nowrap',
        'disabled:opacity-45 disabled:cursor-not-allowed select-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <Loader2 size={size === 'sm' ? 12 : 14} className="animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div {...rest} className={cx('card', className)}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4 px-4 py-3 border-b border-border', className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-text truncate">{title}</h3>
        {subtitle ? <p className="text-xs text-muted mt-0.5">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------

export function Badge({
  children,
  className,
  dot,
}: {
  children: ReactNode;
  className?: string;
  dot?: string;
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-4',
        className ?? 'border-border bg-surface-2 text-muted',
      )}
    >
      {dot ? <span className="h-1.5 w-1.5 rounded-full" style={{ background: dot }} /> : null}
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

const FIELD = 'w-full bg-surface-2 border border-border rounded-lg px-3 text-sm text-text placeholder:text-faint transition-colors focus:border-accent/60 focus:bg-surface-3';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(FIELD, 'h-9', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(FIELD, 'py-2 leading-relaxed resize-y', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...rest} className={cx(FIELD, 'h-9 pr-8 appearance-none cursor-pointer', className)}>
        {children}
      </select>
      <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-faint pointer-events-none" />
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted">
        {label}
        {required ? <span className="text-fail ml-0.5">*</span> : null}
      </span>
      {children}
      {error ? (
        <span className="block text-xs text-fail">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// Table
// ---------------------------------------------------------------------------

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>
  );
}

export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th
      className={cx(
        'text-left text-[11px] font-medium uppercase tracking-wider text-faint px-4 py-2 border-b border-border whitespace-nowrap',
        className,
      )}
    >
      {children}
    </th>
  );
}

export function Td({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={cx('px-4 py-2.5 border-b border-border/60 align-middle', className)}>{children}</td>;
}

export function Tr({ children, onClick, className }: { children: ReactNode; onClick?: () => void; className?: string }) {
  return (
    <tr
      onClick={onClick}
      className={cx(
        'transition-colors',
        onClick ? 'cursor-pointer hover:bg-surface-2/70' : 'hover:bg-surface-2/40',
        className,
      )}
    >
      {children}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 pt-[10vh] animate-in">
      <div className={cx('card w-full shadow-2xl', width)} role="dialog" aria-modal="true">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="text-faint hover:text-text p-1 rounded" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="px-4 py-4">{children}</div>
        {footer ? <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: Array<{ id: T; label: string; count?: number }>;
  active: T;
  onChange: (id: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('flex items-center gap-1 border-b border-border', className)}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cx(
            'relative px-3 py-2 text-sm transition-colors -mb-px border-b-2',
            active === tab.id
              ? 'text-text border-accent'
              : 'text-muted border-transparent hover:text-text hover:border-border-strong',
          )}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="ml-1.5 text-[11px] text-faint mono">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={cx('animate-spin text-faint', className)} />;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-faint">{icon}</div> : null}
      <p className="text-sm font-medium text-text">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-xs text-muted leading-relaxed">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('rounded bg-surface-2 animate-pulse-soft', className)} />;
}

export function Alert({
  tone = 'info',
  title,
  children,
  action,
}: {
  tone?: 'info' | 'warn' | 'error' | 'success';
  title?: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const tones = {
    info: 'border-info/30 bg-info/5 text-info',
    warn: 'border-partial/30 bg-partial/5 text-partial',
    error: 'border-fail/30 bg-fail/5 text-fail',
    success: 'border-pass/30 bg-pass/5 text-pass',
  } as const;
  const icons = { info: Info, warn: AlertTriangle, error: XCircle, success: Check } as const;
  const Icon = icons[tone];
  return (
    <div className={cx('flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs', tones[tone])}>
      <Icon size={14} className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium text-text mb-0.5">{title}</p> : null}
        <div className="text-muted leading-relaxed">{children}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress & score
// ---------------------------------------------------------------------------

export function ProgressBar({ value, className, colour }: { value: number; className?: string; colour?: string }) {
  return (
    <div className={cx('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500 ease-out"
        style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: colour ?? 'var(--color-accent)' }}
      />
    </div>
  );
}

export function ScoreRing({
  score,
  grade,
  size = 88,
  colour,
}: {
  score: number | null;
  grade?: string | null;
  size?: number;
  colour?: string;
}) {
  const value = Math.max(0, Math.min(100, score ?? 0));
  const stroke = size >= 80 ? 7 : 5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const dash = (value / 100) * circumference;
  const strokeColour = colour ?? 'var(--color-accent)';

  return (
    <div className="relative inline-grid place-items-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={strokeColour}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          style={{ transition: 'stroke-dasharray 600ms ease-out' }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="font-semibold leading-none" style={{ fontSize: size >= 80 ? 22 : 14 }}>
            {grade ?? Math.round(value)}
          </div>
          {grade ? <div className="text-[10px] text-faint mt-0.5 mono">{Math.round(value)}</div> : null}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

interface Toast {
  id: number;
  tone: 'info' | 'success' | 'error';
  message: string;
}

const ToastContext = createContext<(tone: Toast['tone'], message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, tone, message }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="fixed bottom-4 right-4 z-[60] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm shadow-xl animate-in',
              toast.tone === 'success' && 'border-pass/30 bg-[#0F1A16] text-pass',
              toast.tone === 'error' && 'border-fail/30 bg-[#1A1014] text-fail',
              toast.tone === 'info' && 'border-border bg-surface-2 text-text',
            )}
          >
            {toast.tone === 'success' ? <Check size={15} className="mt-0.5 shrink-0" /> : null}
            {toast.tone === 'error' ? <AlertTriangle size={15} className="mt-0.5 shrink-0" /> : null}
            {toast.tone === 'info' ? <Info size={15} className="mt-0.5 shrink-0 text-accent" /> : null}
            <p className="flex-1 leading-snug">{toast.message}</p>
            <button
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              className="text-faint hover:text-text"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  return useMemo(
    () => ({
      info: (m: string) => push('info', m),
      success: (m: string) => push('success', m),
      error: (m: string) => push('error', m),
    }),
    [push],
  );
}

// ---------------------------------------------------------------------------
// Copy button
// ---------------------------------------------------------------------------

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const toast = useToast();
  const [done, setDone] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setDone(true);
      setTimeout(() => setDone(false), 1600);
    } catch {
      toast.error('Could not copy to clipboard');
    }
  };

  return (
    <Button size="sm" variant="ghost" onClick={copy} icon={done ? <Check size={12} /> : undefined}>
      {done ? 'Copied' : label}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// GitHub mark (lucide no longer ships brand icons)
// ---------------------------------------------------------------------------

export function GitHubMark({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export { Switch } from './Switch.js';
