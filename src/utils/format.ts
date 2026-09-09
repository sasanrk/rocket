const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export interface FormattedBytes {
  value: string;
  unit: string;
  /** Numeric value already scaled into `unit` */
  scaled: number;
  decimals: number;
}

export function splitBytes(bytes: number): FormattedBytes {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return { value: '0', unit: 'MB', scaled: 0, decimals: 0 };
  }
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), UNITS.length - 1);
  const scaled = bytes / Math.pow(1024, exponent);
  const decimals = exponent === 0 ? 0 : scaled >= 100 ? 0 : scaled >= 10 ? 1 : 2;
  return { value: scaled.toFixed(decimals), unit: UNITS[exponent], scaled, decimals };
}

export function formatBytes(bytes: number): string {
  const { value, unit } = splitBytes(bytes);
  return `${value} ${unit}`;
}

export function formatCount(count: number): string {
  return new Intl.NumberFormat('en-US').format(count);
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function formatPercent(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return '—';
  return `${value.toFixed(decimals)}%`;
}

/** Short, absolute clock time — a log is easier to scan than "3 minutes ago". */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function formatGHz(mhz: number | null): string {
  if (mhz === null || !Number.isFinite(mhz)) return '—';
  return `${(mhz / 1000).toFixed(2)} GHz`;
}
