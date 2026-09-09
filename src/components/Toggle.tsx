import { Loader2Icon } from 'lucide-react';
import { cn } from '../utils/cn';

/** A two-state switch styled as a small button, busy while Windows answers. */
export function Toggle({ on, busy, disabled, onChange, labelOn = 'On', labelOff = 'Off' }: {on: boolean;busy: boolean;disabled?: boolean;onChange: (next: boolean) => void;labelOn?: string;labelOff?: string;}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={busy || disabled}
      onClick={() => onChange(!on)}
      className={cn(
        'inline-flex w-[88px] shrink-0 items-center justify-center gap-1.5 rounded-md border px-2 py-1 text-[11.5px] font-medium transition-colors duration-150 ease-swift disabled:opacity-40',
        on ? 'border-accent/40 bg-accent/10 text-accent hover:bg-accent/20' : 'border-line text-muted hover:text-ink'
      )}>

      {busy ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> : on ? labelOn : labelOff}
    </button>);

}

