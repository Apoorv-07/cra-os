import { cx } from '../lib/format';

/** Accessible toggle used for settings that take effect immediately. */
export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
        checked ? 'border-accent/50 bg-accent/30' : 'border-border bg-surface-3',
        disabled && 'opacity-50 cursor-not-allowed',
      )}
    >
      <span
        className={cx(
          'inline-block h-3.5 w-3.5 transform rounded-full transition-transform',
          checked ? 'translate-x-[18px] bg-accent' : 'translate-x-[3px] bg-faint',
        )}
      />
    </button>
  );
}
