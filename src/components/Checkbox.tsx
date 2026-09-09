import { motion } from 'framer-motion';
import { CheckIcon, MinusIcon } from 'lucide-react';
import { cn } from '../utils/cn';

export type CheckState = 'none' | 'some' | 'all';

interface CheckboxProps {
  state: CheckState;
  label: string;
  onChange: () => void;
  disabled?: boolean;
  className?: string;
}

export function Checkbox({ state, label, onChange, disabled, className }: CheckboxProps) {
  const checked = state === 'all';
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={state === 'some' ? 'mixed' : checked}
      aria-label={label}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onChange();
      }}
      className={cn(
        'flex h-[18px] w-[18px] items-center justify-center rounded-[5px] border transition-colors duration-150 ease-swift',
        state === 'none' ?
        'border-line bg-transparent hover:border-faint' :
        'border-accent bg-accent text-accent-ink',
        disabled && 'cursor-not-allowed opacity-30 hover:border-line',
        className
      )}>
      
      {state !== 'none' &&
      <motion.span
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.14, ease: [0.23, 1, 0.32, 1] }}
        className="flex">
        
          {state === 'some' ?
        <MinusIcon className="h-3 w-3" strokeWidth={3} /> :

        <CheckIcon className="h-3 w-3" strokeWidth={3} />
        }
        </motion.span>
      }
    </button>);

}