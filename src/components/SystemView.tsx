import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  CircuitBoardIcon,
  CopyIcon,
  CpuIcon,
  HardDriveIcon,
  InfoIcon,
  Loader2Icon,
  MemoryStickIcon,
  MonitorIcon,
  NetworkIcon,
  PcCaseIcon,
  RefreshCwIcon,
  SparklesIcon,
  CheckIcon } from
'lucide-react';
import { toast } from 'sonner';
import type { SystemReport, UpgradeAdvice } from '../types/specs';
import { desktop } from '../utils/desktopBridge';
import { formatBytes, formatTime, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

const GB = 1024 * 1024 * 1024;

function gb(bytes: number | null | undefined): string {
  if (!bytes) return '—';
  return `${Math.round(bytes / GB)} GB`;
}

function cleanCpu(name: string): string {
  return name.replace(/\(R\)|\(TM\)/g, '').replace(/\s+CPU\s+@.*$/, '').replace(/\s+/g, ' ').trim();
}

function Card({ icon, title, children, className, aside }: {icon: React.ReactNode;title: string;children: React.ReactNode;className?: string;aside?: React.ReactNode;}) {
  return (
    <section className={cn('flex flex-col rounded-xl border border-line bg-surface', className)}>
      <h2 className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
          {icon}
          {title}
        </span>
        {aside}
      </h2>
      <div className="min-h-0 flex-1 p-4">{children}</div>
    </section>);

}

function Row({ label, value, mono = false }: {label: string;value: React.ReactNode;mono?: boolean;}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-[11.5px] text-faint">{label}</dt>
      <dd className={cn('min-w-0 truncate text-right text-[12.5px] text-ink', mono && 'font-mono text-[11.5px]')} title={typeof value === 'string' ? value : undefined}>
        {value}
      </dd>
    </div>);

}

const AREA_LABEL: Record<UpgradeAdvice['area'], string> = { ram: 'Memory', cpu: 'Processor', gpu: 'Graphics', storage: 'Storage', os: 'Windows' };

function AdviceCard({ item, index }: {item: UpgradeAdvice;index: number;}) {
  const Icon = item.tone === 'good' ? CheckCircle2Icon : item.tone === 'upgrade' ? ArrowUpRightIcon : InfoIcon;
  return (
    <motion.li
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, delay: index * 0.04, ease: [0.23, 1, 0.32, 1] }}
      className={cn(
        'rounded-xl border p-4',
        item.tone === 'upgrade' ? 'border-accent/30 bg-accent/5' : item.tone === 'good' ? 'border-line bg-surface' : 'border-line bg-surface'
      )}>

      <div className="flex items-start gap-3">
        <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', item.tone === 'upgrade' ? 'bg-accent/15 text-accent' : item.tone === 'good' ? 'bg-accent/10 text-accent' : 'bg-raised text-faint')}>
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">{AREA_LABEL[item.area]}</span>
            <span className={cn('rounded-md px-1.5 py-0.5 text-[10px] font-medium', item.tone === 'upgrade' ? 'bg-accent/10 text-accent' : item.tone === 'good' ? 'bg-raised text-muted' : 'bg-raised text-faint')}>
              {item.tone === 'upgrade' ? 'worth doing' : item.tone === 'good' ? 'already good' : 'good to know'}
            </span>
            <span className="text-[10px] text-faint">{item.confidence === 'high' ? 'sure' : item.confidence === 'medium' ? 'fairly sure' : 'a guess'}</span>
          </div>
          <p className="mt-1 text-[13.5px] font-semibold leading-snug tracking-tight text-ink">{item.title}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{item.why}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-ink">
            <span className="font-medium text-accent">What to do: </span>
            {item.suggestion}
          </p>
        </div>
      </div>
    </motion.li>);

}

function specsAsText(report: SystemReport): string {
  const { specs, platform } = report;
  const lines = [
  `${specs.computer.manufacturer} ${specs.computer.model}`.trim(),
  `${specs.os.name} ${specs.os.version} (${specs.os.arch})`,
  `Board: ${specs.board.manufacturer} ${specs.board.product} · BIOS ${specs.board.bios}`,
  `CPU: ${cleanCpu(specs.cpu.name)} · ${specs.cpu.cores} cores / ${specs.cpu.threads} threads · socket ${platform.socket}`,
  `RAM: ${gb(specs.memory.totalBytes)} ${platform.ramType ?? ''} in ${specs.memory.modules.length}/${specs.memory.slots ?? '?'} slots (max ${gb(specs.memory.maxBytes)})`,
  ...specs.memory.modules.map((module) => `  ${module.slot}: ${gb(module.bytes)} ${module.type ?? ''} ${module.speed ?? ''} MHz ${module.manufacturer} ${module.partNumber}`.trim()),
  ...specs.gpus.map((gpu) => `GPU: ${gpu.name}${gpu.vramBytes ? ` (${gb(gpu.vramBytes)})` : ''} · driver ${gpu.driver}`),
  ...specs.disks.map((disk) => `Disk: ${disk.name} · ${disk.mediaType} ${disk.bus} · ${formatBytes(disk.bytes)}${disk.letter ? ` · ${disk.letter}` : ''}${disk.system ? ' (Windows)' : ''}`),
  ...specs.network.map((nic) => `Network: ${nic.name}${nic.speedBps ? ` · ${Math.round(nic.speedBps / 1_000_000)} Mbps` : ''}${nic.up ? ' · up' : ''}`),
  ...specs.monitors.map((monitor) => `Display: ${monitor.name} ${monitor.width && monitor.height ? `${monitor.width}x${monitor.height}` : ''}`.trim())];

  return lines.join('\n');
}

/**
 * Everything in the box, and what the box could take: the socket decides the
 * processor ceiling, the memory array the RAM ceiling, the chipset generation
 * whether NVMe is even an option. Read once, cached, refreshable.
 */
export function SystemView() {
  const [report, setReport] = useState<SystemReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    try {
      setReport(await desktop.systemReport());
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const upgrades = useMemo(() => (report ? report.advice.filter((item) => item.tone === 'upgrade') : []), [report]);

  if (!report) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Loader2Icon className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          {error ?? 'Reading the hardware — the first time takes a few seconds while Windows wakes its inventory…'}
        </p>
      </div>);

  }

  const { specs, platform, advice } = report;
  const slots = specs.memory.slots ?? specs.memory.modules.length;
  const perSlot = specs.memory.maxBytes && slots ? specs.memory.maxBytes / slots : null;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-accent">
            <PcCaseIcon className="h-3.5 w-3.5" strokeWidth={2.4} />
            {specs.computer.type === 'laptop' ? 'Laptop' : 'Desktop'}
          </p>
          <h1 className="mt-1.5 text-[24px] font-semibold leading-tight tracking-tight text-ink">
            {`${specs.computer.manufacturer} ${specs.computer.model}`.trim() || 'This PC'}
          </h1>
          <p className="mt-1 text-[12.5px] text-muted">
            {cleanCpu(specs.cpu.name)} · {gb(specs.memory.totalBytes)} {platform.ramType ?? ''} · {specs.gpus.find((gpu) => !/Intel|Basic/i.test(gpu.name))?.name ?? specs.gpus[0]?.name ?? 'no graphics reported'} · {specs.os.name.replace('Microsoft ', '')}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(specsAsText(report)).then(() => {
                setCopied(true);
                toast.success('Specs copied', { description: 'Paste them into a forum post, a support ticket or a shop enquiry.' });
              });
            }}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink">

            {copied ? <CheckIcon className="h-3.5 w-3.5 text-accent" strokeWidth={2.4} /> : <CopyIcon className="h-3.5 w-3.5" strokeWidth={2} />}
            Copy specs
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink disabled:opacity-40">

            <RefreshCwIcon className={cn('h-3.5 w-3.5', loading && 'animate-spin')} strokeWidth={2} />
            Read again
          </button>
        </div>
      </div>

      {upgrades.length > 0 &&
      <div className="mt-4 flex items-center gap-2 rounded-xl border border-accent/30 bg-accent/5 px-4 py-3">
          <SparklesIcon className="h-4 w-4 shrink-0 text-accent" strokeWidth={2.2} />
          <p className="text-[12.5px] text-ink">
            <span className="font-semibold">{pluralize(upgrades.length, 'upgrade')} this box can take</span>
            <span className="text-muted"> — worked out from socket {platform.socket}, {slots} memory slots and the drives inside. Details below the specs.</span>
          </p>
        </div>
      }

      <div className="mt-4 grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
        <Card icon={<CpuIcon className="h-3.5 w-3.5" strokeWidth={2} />} title="Processor">
          <p className="text-[15px] font-semibold tracking-tight text-ink">{cleanCpu(specs.cpu.name)}</p>
          <dl className="mt-2 divide-y divide-line/60">
            <Row label="Cores / threads" value={`${specs.cpu.cores} / ${specs.cpu.threads}`} />
            <Row label="Rated clock" value={specs.cpu.maxMHz ? `${(specs.cpu.maxMHz / 1000).toFixed(2)} GHz` : '—'} />
            <Row label="Socket" value={`${platform.socket}${specs.cpu.socket && specs.cpu.socket !== platform.socket ? ` (${specs.cpu.socket})` : ''}`} />
            <Row label="Generation" value={`${platform.vendor} ${platform.generation ?? '—'}`} />
            <Row label="Cache" value={`${specs.cpu.l2KB ? `L2 ${specs.cpu.l2KB / 1024} MB` : ''}${specs.cpu.l3KB ? ` · L3 ${specs.cpu.l3KB / 1024} MB` : ''}` || '—'} />
          </dl>
        </Card>

        <Card
          icon={<MemoryStickIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          title="Memory"
          aside={<span className="text-[11px] text-muted">{specs.memory.modules.length} of {slots} slots · max {gb(specs.memory.maxBytes)}</span>}>

          <p className="text-[15px] font-semibold tracking-tight text-ink">
            {gb(specs.memory.totalBytes)} {platform.ramType ?? ''}
            {specs.memory.modules[0]?.configuredSpeed ? <span className="text-[12px] font-normal text-muted"> at {specs.memory.modules[0].configuredSpeed} MHz</span> : null}
          </p>
          <div className="mt-3 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(slots, 8))}, minmax(0, 1fr))` }}>
            {Array.from({ length: Math.max(slots, specs.memory.modules.length) }).map((_, index) => {
              const module = specs.memory.modules[index];
              const fill = module && perSlot ? Math.min(1, module.bytes / perSlot) : module ? 1 : 0;
              return (
                <div
                  key={module ? module.slot : `empty-${index}`}
                  className={cn('rounded-lg border px-2 py-2 text-center', module ? 'border-accent/30 bg-accent/5' : 'border-dashed border-line')}
                  title={module ? `${module.slot} · ${module.manufacturer} ${module.partNumber} · ${module.speed ?? '?'} MHz` : 'Empty slot'}>

                  <div className="mx-auto h-8 w-2 overflow-hidden rounded-full bg-line">
                    <div className="w-full rounded-full bg-accent" style={{ height: `${fill * 100}%`, marginTop: `${(1 - fill) * 100}%` }} />
                  </div>
                  <p className="mt-1.5 text-[12px] font-medium text-ink">{module ? gb(module.bytes) : 'empty'}</p>
                  <p className="truncate text-[10px] text-faint">{module ? module.slot : 'free'}</p>
                </div>);

            })}
          </div>
          <ul className="mt-3 space-y-1">
            {specs.memory.modules.map((module) =>
            <li key={module.slot} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate text-muted">{module.slot} · {module.manufacturer} {module.partNumber}</span>
                <span className="shrink-0 font-mono text-faint">{module.type ?? '?'}-{module.speed ?? '?'}{module.configuredSpeed && module.speed && module.configuredSpeed < module.speed ? ` @ ${module.configuredSpeed}` : ''}</span>
              </li>
            )}
          </ul>
        </Card>

        <Card icon={<MonitorIcon className="h-3.5 w-3.5" strokeWidth={2} />} title="Graphics & display">
          <ul className="space-y-2.5">
            {specs.gpus.map((gpu) =>
            <li key={gpu.name}>
                <p className="text-[13px] font-medium text-ink">{gpu.name}</p>
                <p className="text-[11px] text-faint">{gpu.vramBytes ? `${gb(gpu.vramBytes)} video memory · ` : ''}driver {gpu.driver}</p>
              </li>
            )}
            {specs.gpus.length === 0 && <li className="text-[12px] text-faint">No graphics adapter reported.</li>}
          </ul>
          {specs.monitors.length > 0 &&
          <dl className="mt-3 divide-y divide-line/60 border-t border-line pt-1">
              {specs.monitors.map((monitor, index) =>
            <Row key={`${monitor.name}-${index}`} label={monitor.name} value={monitor.width && monitor.height ? `${monitor.width} × ${monitor.height}` : '—'} />
            )}
            </dl>
          }
        </Card>

        <Card icon={<CircuitBoardIcon className="h-3.5 w-3.5" strokeWidth={2} />} title="Motherboard & firmware">
          <p className="text-[15px] font-semibold tracking-tight text-ink">{`${specs.board.manufacturer} ${specs.board.product}`.trim() || 'Unknown board'}</p>
          <dl className="mt-2 divide-y divide-line/60">
            <Row label="BIOS" value={`${specs.board.bios}${specs.board.biosDate ? ` · ${new Date(specs.board.biosDate).toLocaleDateString(undefined, { year: 'numeric', month: 'short' })}` : ''}`} />
            <Row label="CPU socket" value={platform.socket} />
            <Row label="Memory it takes" value={`${platform.ramType ?? platform.ram ?? '—'} · ${slots} slots · up to ${gb(specs.memory.maxBytes)}`} />
            <Row label="NVMe M.2" value={platform.nvme === null ? 'unknown' : platform.nvme ? 'yes, this generation has it' : 'no — SATA only'} />
            <Row label="Best CPU for the socket" value={platform.best ?? '—'} />
          </dl>
        </Card>

        <Card icon={<HardDriveIcon className="h-3.5 w-3.5" strokeWidth={2} />} title="Storage">
          <ul className="space-y-3">
            {specs.disks.map((disk) => {
              const usedRatio = disk.totalBytes > 0 && disk.freeBytes !== null ? 1 - disk.freeBytes / disk.totalBytes : null;
              return (
                <li key={`${disk.name}-${disk.letter ?? ''}`}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-medium text-ink">
                      {disk.letter ? <span className="font-mono">{disk.letter} </span> : null}
                      {disk.name}
                      {disk.system && <span className="ml-1.5 rounded-md bg-raised px-1.5 py-0.5 text-[10px] text-faint">Windows</span>}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted">{formatBytes(disk.bytes)}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] text-faint">{disk.mediaType} over {disk.bus} · {disk.health}{disk.freeBytes !== null ? ` · ${formatBytes(disk.freeBytes)} free` : ''}</p>
                  {usedRatio !== null &&
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-line">
                      <div className={cn('h-full rounded-full', usedRatio > 0.9 ? 'bg-danger' : usedRatio > 0.8 ? 'bg-node' : 'bg-accent')} style={{ width: `${usedRatio * 100}%` }} />
                    </div>
                  }
                </li>);

            })}
          </ul>
        </Card>

        <Card icon={<NetworkIcon className="h-3.5 w-3.5" strokeWidth={2} />} title="Windows & network">
          <dl className="divide-y divide-line/60">
            <Row label="Windows" value={`${specs.os.name.replace('Microsoft ', '')} · build ${specs.os.build}`} />
            <Row label="Installed" value={specs.os.installedAt ? formatTime(specs.os.installedAt) : '—'} />
            <Row label="Architecture" value={specs.os.arch} />
          </dl>
          <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
            {specs.network.map((nic, index) =>
            <li key={`${nic.name}-${index}`} className="flex items-center justify-between gap-3 text-[11.5px]">
                <span className="min-w-0 truncate text-muted">{nic.name}</span>
                <span className="shrink-0 font-mono text-[10.5px] text-faint">{nic.speedBps ? `${Math.round(nic.speedBps / 1_000_000)} Mbps` : ''}{nic.up ? ' · up' : ''}</span>
              </li>
            )}
            {specs.network.length === 0 && <li className="text-[12px] text-faint">No physical adapters reported.</li>}
          </ul>
        </Card>
      </div>

      <section className="mt-5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-ink">
          <ArrowUpRightIcon className="h-4 w-4 text-accent" strokeWidth={2.4} />
          Upgrade paths
        </h2>
        <p className="mt-1 text-[12.5px] text-muted">
          What this exact board can take, from what it reports: socket {platform.socket}, {platform.ramType ?? platform.ram ?? 'memory'} up to {gb(specs.memory.maxBytes)}, {platform.nvme ? 'NVMe capable' : 'SATA storage'}.
          {' '}Nothing here was looked up online; the confidence tag says how much of it is table knowledge versus a reading.
        </p>
        <ul className="mt-3 grid gap-3 xl:grid-cols-2">
          {advice.map((item, index) => <AdviceCard key={item.id} item={item} index={index} />)}
        </ul>
      </section>

      <p className="mt-4 pb-2 text-[11px] leading-relaxed text-faint">
        Read in {Math.round(report.tookMs / 100) / 10}s from SMBIOS and WMI, the same sources Task Manager and System Information use. Part numbers are what the memory sticks report about themselves.
      </p>
    </div>);

}
