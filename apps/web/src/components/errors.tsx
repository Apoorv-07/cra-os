import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, ChevronDown, RefreshCw } from 'lucide-react';
import { Button } from './ui';
import { cx } from '../lib/format';

/**
 * Failure surfaces.
 *
 * This is a compliance product: a blank screen is worse than a wrong number,
 * because the user cannot tell "no data" from "broken". Every page therefore
 * has the same three failure shapes — a recoverable panel, a full-page state,
 * and a boundary that catches what we did not anticipate.
 *
 * Technical detail is available one interaction away for the person who has to
 * fix it, and never shown to the person who just wants their report.
 */

function TechnicalDetails({ error }: { error: unknown }) {
  const message =
    error instanceof Error
      ? `${error.name}: ${error.message}`
      : typeof error === 'string'
        ? error
        : 'Unexpected error';

  return (
    <details className="mt-3 text-left">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 text-[11px] text-faint hover:text-muted">
        <ChevronDown size={12} /> Technical details
      </summary>
      <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border bg-surface-2/60 p-2.5 text-[11px] leading-relaxed text-muted">
        <code>{message}</code>
      </pre>
    </details>
  );
}

/** Inline failure for one panel or section, leaving the rest of the page usable. */
export function ErrorState({
  title = 'Something went wrong while loading this',
  error,
  onRetry,
  className,
}: {
  title?: string;
  error?: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center px-5 py-10 text-center', className)}>
      <AlertOctagon size={20} className="mb-2.5 text-fail/80" />
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted">
        Nothing was lost — this is a display problem, not a data problem.
      </p>
      {onRetry ? (
        <Button size="sm" className="mt-3" icon={<RefreshCw size={13} />} onClick={onRetry}>
          Try again
        </Button>
      ) : null}
      {error ? <TechnicalDetails error={error} /> : null}
    </div>
  );
}

/** Full-page failure, for a route whose only content failed to load. */
export function PageError({
  title = 'Something went wrong',
  description = 'We could not load this page. Your data is safe — try again, or come back to it in a moment.',
  error,
  onRetry,
}: {
  title?: string;
  description?: string;
  error?: unknown;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <div className="mx-auto mb-4 grid h-11 w-11 place-items-center rounded-xl border border-border bg-surface-2">
        <AlertOctagon size={18} className="text-fail/80" />
      </div>
      <h1 className="text-lg font-semibold tracking-tight text-text">{title}</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted">{description}</p>
      <div className="mt-5 flex items-center justify-center gap-2">
        {onRetry ? (
          <Button variant="primary" icon={<RefreshCw size={14} />} onClick={onRetry}>
            Try again
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => (window.location.href = '/app')}>
          Back to overview
        </Button>
      </div>
      {error ? <TechnicalDetails error={error} /> : null}
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Shown instead of the children, receives the error and a reset callback. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface BoundaryState {
  error: Error | null;
}

/**
 * Catches render-time failures so one bad component never blanks the product.
 * Mounted around each route; `resetKey` semantics are handled by remounting
 * through React Router's element identity.
 */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Structured enough to grep for in logs, without shipping a stack trace to
    // the browser console of a customer.
    console.error('[craos] render error', { message: error.message, componentStack: info.componentStack });
  }

  reset = (): void => this.setState({ error: null });

  override render(): ReactNode {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback(this.state.error, this.reset);
      return <PageError error={this.state.error} onRetry={this.reset} />;
    }
    return this.props.children;
  }
}

/** Wraps a route element with the standard boundary. */
export function withErrorBoundary(children: ReactNode): ReactNode {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
