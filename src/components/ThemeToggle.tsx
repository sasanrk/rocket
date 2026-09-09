import { motion } from 'framer-motion';
import { MoonIcon, SunIcon } from 'lucide-react';
import { useTheme, type Theme } from '../contexts/ThemeContext';
import { cn } from '../utils/cn';

const OPTIONS: {value: Theme;label: string;Icon: typeof SunIcon;}[] = [
{ value: 'dark', label: 'Dark theme', Icon: MoonIcon },
{ value: 'light', label: 'Light theme', Icon: SunIcon }];


export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="group"
      aria-label="Color theme"
      className="relative flex items-center gap-0.5 rounded-lg border border-line bg-raised p-0.5">
      
      {OPTIONS.map(({ value, label, Icon }) => {
        const isActive = theme === value;
        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={isActive}
            onClick={() => setTheme(value)}
            className={cn(
              'relative flex h-7 w-8 items-center justify-center rounded-md transition-colors duration-150 ease-swift',
              isActive ? 'text-ink' : 'text-faint hover:text-muted'
            )}>
            
            {isActive &&
            <motion.span
              layoutId="theme-toggle-pill"
              transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
              className="absolute inset-0 rounded-md border border-line bg-surface" />

            }
            <Icon className="relative h-3.5 w-3.5" strokeWidth={2} />
          </button>);

      })}
    </div>);

}