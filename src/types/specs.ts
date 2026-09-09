/** Shapes behind the This PC page. */

export interface MemoryModule {
  slot: string;
  bank: string;
  bytes: number;
  speed: number | null;
  configuredSpeed: number | null;
  type: string | null;
  formFactor: string;
  manufacturer: string;
  partNumber: string;
}

export interface GpuInfo {
  name: string;
  vramBytes: number | null;
  driver: string;
  resolution: string | null;
}

export interface DiskSpec {
  name: string;
  mediaType: string;
  bus: string;
  bytes: number;
  health: string;
  /** True for the disk Windows boots from, when it can be told. */
  system: boolean;
  letter: string | null;
  totalBytes: number;
  freeBytes: number | null;
}

export interface SystemSpecs {
  computer: {manufacturer: string;model: string;family: string;type: 'desktop' | 'laptop' | 'other';};
  os: {name: string;version: string;build: string;arch: string;installedAt: string | null;};
  board: {manufacturer: string;product: string;version: string;bios: string;biosDate: string | null;};
  cpu: {name: string;cores: number;threads: number;maxMHz: number | null;socket: string;l2KB: number | null;l3KB: number | null;};
  memory: {totalBytes: number;maxBytes: number | null;slots: number | null;modules: MemoryModule[];};
  gpus: GpuInfo[];
  disks: DiskSpec[];
  network: {name: string;speedBps: number | null;up: boolean;}[];
  monitors: {name: string;width: number | null;height: number | null;}[];
}

export interface UpgradeAdvice {
  id: string;
  area: 'ram' | 'cpu' | 'gpu' | 'storage' | 'os';
  tone: 'good' | 'upgrade' | 'info';
  title: string;
  why: string;
  suggestion: string;
  confidence: 'high' | 'medium' | 'low';
}

export interface UpgradePlatform {
  vendor: string;
  generation: string | null;
  socket: string;
  ram: string | null;
  ramType: string | null;
  ramMaxGB: number | null;
  ramSlots: number | null;
  ramFreeSlots: number | null;
  best: string | null;
  nvme: boolean | null;
  mobile: boolean;
  era: number | null;
}

export interface SystemReport {
  specs: SystemSpecs;
  platform: UpgradePlatform;
  advice: UpgradeAdvice[];
  /** Milliseconds the reading took; the first one loads WMI providers and is slow. */
  tookMs: number;
}
