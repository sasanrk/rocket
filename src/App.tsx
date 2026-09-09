import { ThemeProvider } from './contexts/ThemeContext';
import { storedPref } from './utils/prefs';
import { MachineProvider } from './contexts/MachineContext';
import { CleanerProvider } from './contexts/CleanerContext';
import { JunkProvider } from './contexts/JunkContext';
import { CpuProvider } from './contexts/CpuContext';
import { Workspace } from './components/Workspace';

interface AppProps {
  /** Theme a fresh install boots into. A stored choice, once made, wins. */
  theme?: 'dark' | 'light';
  /** Row height of the project table for dense project folders. */
  density?: 'comfortable' | 'compact';
}

export function App({ theme = 'dark', density = 'comfortable' }: AppProps) {
  return (
    <ThemeProvider initialTheme={theme}>
      <MachineProvider>
        <CleanerProvider>
          <JunkProvider>
            <CpuProvider>
              <Workspace density={storedPref('density') ?? density} />
            </CpuProvider>
          </JunkProvider>
        </CleanerProvider>
      </MachineProvider>
    </ThemeProvider>);

}
