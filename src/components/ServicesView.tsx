import { useEffect } from 'react';
import { HardDriveIcon, Loader2Icon, ServerCogIcon } from 'lucide-react';
import { useCpu } from '../contexts/CpuContext';
import { Toggle } from './Toggle';

/**
 * Two services that read the disk and burn CPU on your behalf. Both are
 * reversible from the same switch; neither affects anything beyond the
 * feature named.
 */
export function ServicesView() {
  const { cpu, error, busy, toggleService, watchLive, isNative } = useCpu();

  useEffect(() => watchLive(), [watchLive]);

  if (!cpu) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <Loader2Icon className="h-4 w-4 animate-spin" strokeWidth={1.8} />
          {error ? error : 'Reading the services…'}
        </p>
      </div>);

  }

  const services = Object.values(cpu.services);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-5">
      <div className="rounded-xl border border-line bg-surface px-4 py-3.5">
        <p className="flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
          <HardDriveIcon className="h-3.5 w-3.5" strokeWidth={2} />
          Windows drive
        </p>
        <p className="mt-2 text-[13px] text-ink">
          {cpu.systemDriveIsSsd === null ?
          'Could not tell whether Windows is on an SSD or a hard disk.' :
          cpu.systemDriveIsSsd ?
          'Windows is on an SSD, so SysMain costs little either way. Search indexing is the one that matters on a build machine.' :
          'Windows is on a hard disk. SysMain reads it in the background constantly; turning it off usually makes the machine feel quicker.'}
        </p>
      </div>

      <section className="mt-3 rounded-xl border border-line bg-surface">
        <h2 className="flex items-center gap-1.5 border-b border-line px-4 py-2.5 text-[10.5px] font-medium uppercase tracking-wide text-faint">
          <ServerCogIcon className="h-3.5 w-3.5" strokeWidth={2} />
          Services
        </h2>
        <ul className="divide-y divide-line/60">
          {services.map((service) => {
            const on = service.startType !== 'Disabled';
            return (
              <li key={service.name} className="flex items-start justify-between gap-4 px-4 py-3.5">
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-[13px] font-medium text-ink">
                    {service.label}
                    <span className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[10px] text-faint">
                      {service.present ? `${service.status.toLowerCase()} · ${service.startType.toLowerCase()}` : 'not installed'}
                    </span>
                  </span>
                  <span className="mt-1 block text-[12px] leading-relaxed text-muted">{service.detail}</span>
                  <span className="mt-1 block text-[11px] text-faint">
                    {on ? 'Turning it off stops it now and keeps it off after a restart.' : 'Turning it on starts it now and at every boot.'}{' '}
                    Windows asks for administrator permission either way.
                  </span>
                </span>
                <Toggle
                  on={on}
                  busy={busy === `service:${service.name}`}
                  disabled={busy !== null || !service.present || !isNative}
                  onChange={(next) => void toggleService(service, next)}
                  labelOn="Running"
                  labelOff="Off" />

              </li>);

          })}
        </ul>
      </section>
      {!isNative && <p className="mt-3 text-[11.5px] text-faint">The browser preview shows simulated services; changes need the desktop app.</p>}
    </div>);

}
