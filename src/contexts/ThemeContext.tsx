import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { storedPref, writePref, type Theme } from '../utils/prefs';

export type { Theme };

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

interface ThemeProviderProps {
  /** Theme for a machine that has never chosen one; a stored choice wins. */
  initialTheme?: Theme;
  children: React.ReactNode;
}

export function ThemeProvider({ initialTheme = 'dark', children }: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => storedPref('theme') ?? initialTheme);
  const mounted = useRef(false);

  // Only a prop that changes after boot overrides what the user last picked;
  // on the first run the stored theme has already been taken above.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setTheme(initialTheme);
  }, [initialTheme]);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
    // Kept in step with the boot script in index.html, which paints this same
    // colour before React mounts so launching light never flashes dark.
    root.style.backgroundColor = theme === 'dark' ? '#090b0d' : '#f4f6f8';
    writePref('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((current) => current === 'dark' ? 'light' : 'dark');
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ theme, setTheme, toggleTheme }), [theme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside a ThemeProvider');
  }
  return context;
}
