import type { InstalledProgram } from '../types/programs';

const MB = 1024 * 1024;

interface Seed {
  name: string;
  publisher: string;
  version: string;
  size: number;
  date?: string;
  kind?: 'desktop' | 'store';
  scope?: 'machine' | 'user';
  dependency?: boolean;
  hasUninstaller?: boolean;
  location?: string;
}

const SEEDS: Seed[] = [
{ name: 'Google Chrome', publisher: 'Google LLC', version: '128.0.6613.120', size: 620 * MB, date: '2026-08-14', location: 'C:\\Program Files\\Google\\Chrome\\Application' },
{ name: 'Visual Studio Code (User)', publisher: 'Microsoft Corporation', version: '1.93.1', size: 392 * MB, date: '2026-09-01', scope: 'user', location: 'C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code' },
{ name: 'Android Studio', publisher: 'Google LLC', version: '2025.1.3', size: 3200 * MB, date: '2026-07-22', location: 'C:\\Program Files\\Android\\Android Studio' },
{ name: 'Docker Desktop', publisher: 'Docker Inc.', version: '4.34.2', size: 1450 * MB, date: '2026-06-03', location: 'C:\\Program Files\\Docker\\Docker' },
{ name: 'Node.js', publisher: 'Node.js Foundation', version: '22.9.0', size: 88 * MB, date: '2026-08-30', location: 'C:\\Program Files\\nodejs' },
{ name: 'Postman', publisher: 'Postman', version: '11.12.0', size: 410 * MB, date: '2026-05-19', scope: 'user', location: 'C:\\Users\\dev\\AppData\\Local\\Postman' },
{ name: 'Telegram Desktop', publisher: 'Telegram FZ-LLC', version: '5.5.1', size: 96 * MB, date: '2026-04-11', scope: 'user', location: 'C:\\Users\\dev\\AppData\\Roaming\\Telegram Desktop' },
{ name: 'Microsoft Visual C++ 2015-2022 Redistributable (x64) - 14.40.33810', publisher: 'Microsoft Corporation', version: '14.40.33810.0', size: 21 * MB, date: '2026-02-08', dependency: true },
{ name: 'Microsoft Edge WebView2 Runtime', publisher: 'Microsoft Corporation', version: '128.0.2739.67', size: 0, date: '2026-08-15', dependency: true },
{ name: 'NVIDIA Graphics Driver 560.94', publisher: 'NVIDIA Corporation', version: '560.94', size: 1100 * MB, date: '2026-08-20', dependency: true },
{ name: 'Some Trial Tool', publisher: 'Acme Software', version: '2.0', size: 240 * MB, date: '2025-11-02', hasUninstaller: false, location: 'C:\\Program Files (x86)\\Acme\\Trial Tool' },
{ name: 'Spotify', publisher: 'Spotify AB', version: '1.2.45', size: 0, kind: 'store' },
{ name: 'WhatsApp', publisher: 'WhatsApp Inc.', version: '2.2436.5', size: 0, kind: 'store' },
{ name: 'Microsoft Clipchamp', publisher: 'Microsoft Corp.', version: '3.1.2', size: 0, kind: 'store' }];


export function mockPrograms(): InstalledProgram[] {
  return SEEDS.map((seed, index) => ({
    id: seed.kind === 'store' ? `store:${seed.name.replace(/\s/g, '')}_1.0_x64__mock${index}` : `${seed.scope ?? 'machine'}:x64:${seed.name.replace(/\s/g, '')}`,
    kind: seed.kind ?? 'desktop',
    scope: seed.scope ?? (seed.kind === 'store' ? 'user' : 'machine'),
    keyPath: seed.kind === 'store' ? '' : `HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${seed.name}`,
    keyName: seed.name,
    name: seed.name,
    publisher: seed.publisher,
    version: seed.version,
    installDate: seed.date ?? null,
    sizeBytes: seed.size,
    sizeMeasured: false,
    installLocation: seed.location ?? '',
    icon: '',
    hasUninstaller: seed.hasUninstaller ?? true,
    isMsi: false,
    dependency: Boolean(seed.dependency)
  }));
}
