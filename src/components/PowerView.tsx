import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  BatteryIcon,
  GaugeIcon,
  Loader2Icon,
  PlugZapIcon,
  PowerIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  ZapIcon } from
'lucide-react';
import { BRAND } from '../brand';
import { useCpu, useCpuWatch } from '../contexts/CpuContext';
import { Checkbox } from './Checkbox';
import type { CpuInfo, CpuLive } from '../types/system';
import { formatGHz, formatPercent, formatTime, pluralize } from '../utils/format';
import { cn } from '../utils/cn';

/** Tweaks ticked by default: everything that costs nothing on a desktop. */
const DEFAULT_DESKTOP = ['plan', 'max', 'boost', 'cores', 'cooling', 'overlay', 'foreground'];
/** On a laptop the pinned clock and the plan switch are left for the user to opt into. */
const DEFAULT_LAPTOP = ['max', 'boost', 'cooling', 'overlay', 'foreground'];

function Stat({ icon, label, value, sub, ratio, tone = 'accent' }: {icon: React.ReactNode;label: string;value: string;sub: string;ratio?: number;tone?: 'accent' | 'warn' | 'danger';}) {
  return (
    <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
      <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
        {icon}
        {label}
      </p>
      <p className="mt-2 truncate text-[26px] font-semibold leading-none tracking-tight text-ink" title={value}>{value}</p>
      <p className="mt-1.5 truncate text-[11.5px] text-muted" title={sub}>{sub}</p>
      {ratio !== undefined &&
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-line">
          <motion.div
          className={cn('h-full rounded-full', tone === 'danger' ? 'bg-danger' : tone === 'warn' ? 'bg-node' : 'bg-accent')}
          animate={{ width: `${Math.min(100, Math.max(0, ratio * 100))}%` }}
          transition={{ duration: 0.35, ease: [0.23, 1, 0.32, 1] }} />

        </div>
      }
    </div>);

}

function StatePill({ active }: {active: boolean | null;}) {
  return (
    <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-medium', active === true ? 'bg-accent/10 text-accent' : 'bg-raised text-faint')}>
      {active === true ? 'on' : active === false ? 'off' : 'unknown'}
    </span>);

}

interface Finding {
  id: string;
  tone: 'info' | 'warn';
  title: string;
  body: string;
}

/** Turns the reading into the one or two things actually holding the CPU back. */
function buildFindings(cpu: CpuInfo, live: CpuLive): Finding[] {
  const findings: Finding[] = [];
  const perf = live.perfPercent;
  const load = live.utilityPercent;
  const planActive = cpu.tweaks.find((tweak) => tweak.id === 'plan')?.active;
  const maxAc = cpu.settings.max?.ac ?? null;

  if (perf !== null && load !== null && load > 40 && perf < 85) {
    findings.push({
      id: 'throttled',
      tone: 'warn',
      title: `The CPU is busy but running at ${formatPercent(perf, 0)} of its rated clock`,
      body: live.onBattery ?
      'On battery, Windows slows the processor down on purpose. Plug in for full speed, or raise the battery limits below if you need it now.' :
      'With this much load the clock should be at or above 100%. A capped maximum state, a power-saving plan, or thermal throttling holds it down; the changes below fix the first two.'
    });
  }

  if (maxAc !== null && maxAc < 100) {
    findings.push({
      id: 'capped',
      tone: 'warn',
      title: `Maximum processor state is capped at ${maxAc}%`,
      body: 'Anything under 100% disables the turbo entirely on Intel and AMD parts. This is the single most common reason a laptop feels slower than its spec sheet.'
    });
  }

  if (planActive === false) {
    findings.push({
      id: 'plan',
      tone: 'info',
      title: `The ${cpu.activeScheme?.name ?? 'current'} power plan is active`,
      body: 'Balanced lets the clock drop to 5% between keystrokes and takes a moment to ramp back up. High performance holds it ready — on a desktop there is no reason not to.'
    });
  }

  if (perf !== null && perf >= 100 && findings.length === 0) {
    findings.push({
      id: 'fine',
      tone: 'info',
      title: `Turbo is engaged: ${formatGHz(live.currentMHz)} against a rated ${formatGHz(cpu.maxMHz)}`,
      body: 'The clock is where it should be. The remaining changes below keep it there and stop Windows parking cores when the load comes in bursts.'
    });
  }

  return findings;
}

/**
 * Makes the processor run at the speed it was sold at.
 *
 * None of this is overclocking. Windows ships every machine on the Balanced
 * plan with the clock allowed to idle at 5%, cores parked, and on many laptops
 * the maximum state capped below the turbo threshold. Each change here is a
 * power-plan or scheduler setting Windows itself exposes; the originals are
 * kept so one click puts them back.
 */
export function PowerView() {
  useCpuWatch();
  const { cpu, live, error, busy, applyTweaks, restore, isNative } = useCpu();
  const [chosen, setChosen] = useState<Set<string> | null>(null);

  // Tick the sensible set once the machine type is known; after that the
  // selection belongs to the user.
  useEffect(() => {
    if (!cpu || chosen !== null) return;
    const defaults = cpu.isLaptop ? DEFAULT_LAPTOP : DEFAULT_DESKTOP;
    setChosen(new Set(defaults.filter((id) => cpu.tweaks.some((tweak) => tweak.id === id && tweak.available && tweak.active !== true))));
  }, [cpu, chosen]);

  const findings = useMemo(() => (cpu && live ? buildFindings(cpu, live) : []), [cpu, live]);
  const pending = useMemo(
    () => (cpu && chosen ? cpu.tweaks.filter((tweak) => chosen.has(tweak.id) && tweak.available && tweak.active !== true) : []),
    [cpu, chosen]
  );

  function toggle(id: string) {
    setChosen((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);else
      next.add(id);
      return next;
    });
  }

  async function apply() {
    if (pending.length === 0) return;
    const result = await applyTweaks(pending.map((tweak) => tweak.id));
    if (result.ok) setChosen(new Set());
  }

  async function handleRestore() {
    const result = await restore();
    if (result.ok) setChosen(null);
  }

  if (!cpu) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Loader2Icon className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          {error ? error : 'Reading the processor and its power plan…'}
        </p>
      </div>);

  }

  const reading = live ?? cpu.live;
  const perf = reading.perfPercent;
  const load = reading.utilityPercent;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Stat
          icon={<ZapIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Clock right now"
          value={formatGHz(reading.currentMHz)}
          sub={perf === null ? 'first reading on the way' : `${formatPercent(perf, 0)} of the rated ${formatGHz(cpu.maxMHz)}`}
          ratio={perf === null ? undefined : perf / 100}
          tone={perf !== null && perf < 60 ? 'danger' : perf !== null && perf < 90 ? 'warn' : 'accent'} />

        <Stat
          icon={<GaugeIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Load"
          value={load === null ? '—' : formatPercent(load, 0)}
          sub={`across ${cpu.logical} threads on ${pluralize(cpu.cores, 'core')}`}
          ratio={load === null ? undefined : load / 100}
          tone={load !== null && load > 85 ? 'danger' : load !== null && load > 60 ? 'warn' : 'accent'} />

        <Stat
          icon={<PowerIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label="Power plan"
          value={cpu.activeScheme?.name ?? 'Unknown'}
          sub={cpu.overlay === 'unsupported' ? 'no power-mode slider on this machine' : `power mode: ${cpu.overlay}`} />

        <Stat
          icon={cpu.isLaptop ? <BatteryIcon className="h-3.5 w-3.5" strokeWidth={2} /> : <PlugZapIcon className="h-3.5 w-3.5" strokeWidth={2} />}
          label={cpu.isLaptop ? 'Laptop' : 'Desktop'}
          value={cpu.isLaptop ? reading.onBattery ? `${reading.batteryPercent ?? '—'}% battery` : 'Plugged in' : 'Mains power'}
          sub={cpu.name} />

      </div>

      {findings.length > 0 &&
      <div className="mt-3 grid gap-3 xl:grid-cols-2">
          {findings.map((finding) =>
        <div
          key={finding.id}
          className={cn('rounded-xl border p-4', finding.tone === 'warn' ? 'border-node/30 bg-node/5' : 'border-line bg-surface')}>

              <p className="flex items-start gap-2 text-[13px] font-medium text-ink">
                {finding.tone === 'warn' && <TriangleAlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-node" strokeWidth={2.2} />}
                {finding.title}
              </p>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{finding.body}</p>
            </div>
        )}
        </div>
      }

      <section className="mt-3 rounded-xl border border-line bg-surface">
        <h2 className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <span className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
            <ZapIcon className="h-3.5 w-3.5" strokeWidth={2} />
            Make the CPU run at full speed
          </span>
          {cpu.canRestore &&
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => void handleRestore()}
            className="flex items-center gap-1.5 rounded-md border border-line px-2 py-1 text-[11px] font-medium text-muted transition-colors duration-150 ease-swift hover:text-ink disabled:opacity-40"
            title={cpu.backupAt ? `Settings as they were on ${formatTime(cpu.backupAt)}` : undefined}>

              {busy === 'restore' ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} /> : <RotateCcwIcon className="h-3.5 w-3.5" strokeWidth={2} />}
              Restore original settings
            </button>
          }
        </h2>

        <div className="p-4">
          <p className="text-[12.5px] leading-relaxed text-muted">
            None of this overclocks anything. Windows ships every machine set to save power: the clock idles low, cores
            park, and the turbo waits. These are the plan settings that decide that — {BRAND.name} records the originals
            before touching them, so the button above puts everything back.
          </p>

          {cpu.isLaptop &&
          <p className="mt-3 flex items-start gap-2 rounded-lg border border-node/30 bg-node/5 px-3 py-2 text-[11.5px] leading-relaxed text-node">
              <BatteryIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.2} />
              This is a laptop. The changes ticked by default only apply while plugged in; the plan switch and the pinned
              minimum clock cost battery and heat, so they are left for you to choose.
            </p>
          }

          <ul className="mt-3 divide-y divide-line/60 overflow-hidden rounded-lg border border-line">
            {cpu.tweaks.map((tweak) => {
              const done = tweak.active === true || !tweak.available;
              const checked = tweak.available && (chosen?.has(tweak.id) ?? false);
              return (
                <li
                  key={tweak.id}
                  onClick={() => !done && toggle(tweak.id)}
                  className={cn(
                    'flex items-start gap-3 bg-raised/40 px-3 py-2.5 transition-colors duration-150 ease-swift',
                    done ? 'cursor-default' : 'cursor-pointer hover:bg-raised',
                    !tweak.available && 'opacity-60'
                  )}>

                  <Checkbox
                    state={tweak.active === true || checked ? 'all' : 'none'}
                    label={tweak.label}
                    disabled={done}
                    onChange={() => toggle(tweak.id)}
                    className="mt-0.5" />

                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="text-[12.5px] font-medium text-ink">{tweak.label}</span>
                      {tweak.available ?
                      <StatePill active={tweak.active} /> :

                      <span className="shrink-0 rounded-md bg-raised px-1.5 py-0.5 text-[10.5px] font-medium text-faint">not on this machine</span>
                      }
                    </span>
                    <span className="mt-0.5 block text-[11.5px] leading-relaxed text-muted">{tweak.detail}</span>
                    {cpu.isLaptop && tweak.laptopNote &&
                    <span className="mt-0.5 block text-[11px] text-node">{tweak.laptopNote}</span>
                    }
                  </span>
                </li>);

            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[11.5px] leading-relaxed text-faint">
              Windows will ask for administrator permission once for the whole batch — that prompt is the confirmation,
              and declining it changes nothing.
            </p>
            <button
              type="button"
              disabled={busy !== null || pending.length === 0 || !isNative}
              onClick={() => void apply()}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-[12px] font-semibold text-accent-ink transition-opacity duration-150 ease-swift hover:opacity-90 disabled:opacity-50">

              {busy === 'apply' ?
              <>
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" strokeWidth={2.4} />
                  Waiting for permission…
                </> :

              <>
                  <ZapIcon className="h-3.5 w-3.5" strokeWidth={2.2} />
                  {pending.length === 0 ? 'Nothing left to apply' : `Apply ${pluralize(pending.length, 'change')}`}
                </>
              }
            </button>
          </div>
        </div>
      </section>

      <p className="mt-3 pb-2 text-[11.5px] leading-relaxed text-faint">
        For one program that needs the CPU more than the rest right now — a build, an export — the Processes page can
        raise its priority without changing anything machine-wide.
        {!isNative && ' The browser preview shows simulated readings; changes need the desktop app.'}
      </p>
    </div>);

}
