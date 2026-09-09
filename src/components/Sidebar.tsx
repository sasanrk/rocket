import { motion } from 'framer-motion';
import {
  ActivityIcon,
  CpuIcon,
  FolderTreeIcon,
  GaugeIcon,
  HardDriveIcon,
  HistoryIcon,
  HouseIcon,
  LayoutGridIcon,
  PcCaseIcon,
  PackageIcon,
  PowerIcon,
  RocketIcon,
  ServerCogIcon,
  ShieldIcon,
  ZapIcon } from
'lucide-react';
import { BRAND } from '../brand';
import type { ViewId } from './views';
import { ThemeToggle } from './ThemeToggle';
import { cn } from '../utils/cn';

interface NavItem {
  id: ViewId;
  label: string;
  icon: React.ReactNode;
  /** A small pill after the label, e.g. who a page is for. */
  tag?: string;
}

interface NavSection {
  /** A short verb phrase: what the user wants when they open this group. */
  label: string;
  hint: string;
  icon: React.ReactNode;
  items: NavItem[];
}

const ICON = 'h-[15px] w-[15px]';

const SECTIONS: NavSection[] = [
{
  label: 'Free up space',
  hint: 'Disk',
  icon: <FolderTreeIcon className={ICON} strokeWidth={2} />,
  items: [
  { id: 'drives', label: 'Drives', icon: <HardDriveIcon className={ICON} strokeWidth={2} /> },
  { id: 'apps', label: 'App junk', icon: <LayoutGridIcon className={ICON} strokeWidth={2} /> },
  { id: 'programs', label: 'Installed programs', icon: <PackageIcon className={ICON} strokeWidth={2} /> },
  { id: 'projects', label: 'Projects', icon: <FolderTreeIcon className={ICON} strokeWidth={2} />, tag: 'for developers' }]

},
{
  label: 'Speed up',
  hint: 'CPU',
  icon: <ZapIcon className={ICON} strokeWidth={2} />,
  items: [
  { id: 'power', label: 'CPU & power', icon: <ZapIcon className={ICON} strokeWidth={2} /> },
  { id: 'startup', label: 'Startup programs', icon: <PowerIcon className={ICON} strokeWidth={2} /> },
  { id: 'services', label: 'Background services', icon: <ServerCogIcon className={ICON} strokeWidth={2} /> }]

},
{
  label: 'Keep watch',
  hint: 'Live',
  icon: <ActivityIcon className={ICON} strokeWidth={2} />,
  items: [
  { id: 'performance', label: 'Performance', icon: <GaugeIcon className={ICON} strokeWidth={2} /> },
  { id: 'processes', label: 'Processes', icon: <CpuIcon className={ICON} strokeWidth={2} /> },
  { id: 'antivirus', label: 'Antivirus', icon: <ShieldIcon className={ICON} strokeWidth={2} /> },
  { id: 'system', label: 'This PC', icon: <PcCaseIcon className={ICON} strokeWidth={2} />, tag: 'upgrades' }]

}];


interface SidebarProps {
  view: ViewId;
  onSelect: (view: ViewId) => void;
  /** Short live figures shown beside an item: bytes found, CPU share, counts. */
  badges: Partial<Record<ViewId, string>>;
  /** Items that deserve attention right now, shown with an accent dot. */
  attention: Partial<Record<ViewId, boolean>>;
  isNative: boolean;
}

function NavButton({ item, active, badge, attention, onSelect }: {item: NavItem;active: boolean;badge?: string;attention?: boolean;onSelect: () => void;}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group relative flex w-full items-center gap-2.5 rounded-lg py-[7px] pl-2.5 pr-2 text-left text-[12.5px] transition-colors duration-150 ease-swift',
        active ? 'bg-accent/10 font-medium text-ink' : 'text-muted hover:bg-raised hover:text-ink'
      )}>

      {active &&
      /* Centred with inset, never a transform: framer-motion owns `transform`
         on a layoutId element and would overwrite a -translate-y-1/2. */
      <motion.span
        layoutId="sidebar-active"
        className="absolute inset-y-[7px] left-0 w-[3px] rounded-r-full bg-accent"
        transition={{ duration: 0.22, ease: [0.23, 1, 0.32, 1] }} />

      }
      <span className={cn('flex shrink-0', active ? 'text-accent' : 'text-faint group-hover:text-muted')}>{item.icon}</span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.tag &&
      <span className="shrink-0 rounded-full border border-accent/30 bg-gradient-to-r from-accent/15 to-node/15 px-1.5 py-[1px] text-[9px] font-semibold uppercase tracking-[0.06em] text-accent">
          {item.tag}
        </span>
      }
      {attention && !badge && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-node" />}
      {badge &&
      <span
        className={cn(
          'shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums',
          attention ? 'bg-node/10 text-node' : 'bg-raised text-faint'
        )}>

          {badge}
        </span>
      }
    </button>);

}

/**
 * The left rail: brand at the top, the three things the app does as
 * sections with their pages underneath, history and the theme at the bottom.
 */
export function Sidebar({ view, onSelect, badges, attention, isNative }: SidebarProps) {
  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-r border-line bg-surface">
      <button
        type="button"
        onClick={() => onSelect('home')}
        className="flex items-center gap-3 border-b border-line px-4 py-4 text-left transition-colors duration-150 ease-swift hover:bg-raised/60">

        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#0b7a57] text-accent-ink shadow-[0_6px_18px_-6px_rgb(61_220_151/0.7)]">
          <RocketIcon className="h-[19px] w-[19px]" strokeWidth={2.2} />
        </span>
        <span className="min-w-0 leading-none">
          <span className="block text-[14px] font-semibold tracking-tight text-ink">{BRAND.name}</span>
          <span className="mt-1 block truncate text-[10.5px] text-faint" title={BRAND.tagline}>{BRAND.short}</span>
        </span>
      </button>

      <nav className="min-h-0 flex-1 overflow-y-auto scroll-slim px-3 py-3">
        <NavButton
          item={{ id: 'home', label: 'Overview', icon: <HouseIcon className={ICON} strokeWidth={2} /> }}
          active={view === 'home'}
          onSelect={() => onSelect('home')} />


        {SECTIONS.map((section) =>
        <div key={section.label} className="mt-4">
            <p className="flex items-center justify-between px-2.5 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
              {section.label}
              <span className="font-mono text-[9.5px] font-normal normal-case tracking-normal text-faint/70">{section.hint}</span>
            </p>
            <div className="space-y-0.5">
              {section.items.map((item) =>
            <NavButton
              key={item.id}
              item={item}
              active={view === item.id}
              badge={badges[item.id]}
              attention={attention[item.id]}
              onSelect={() => onSelect(item.id)} />

            )}
            </div>
          </div>
        )}

        <div className="mt-4 border-t border-line pt-3">
          <NavButton
            item={{ id: 'history', label: 'History', icon: <HistoryIcon className={ICON} strokeWidth={2} /> }}
            active={view === 'history'}
            badge={badges.history}
            onSelect={() => onSelect('history')} />

        </div>
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-2.5">
        <div className="min-w-0 leading-tight">
          <p className="text-[10.5px] text-faint">
            {isNative ? `v${BRAND.version}` : 'Preview · simulated data'}
          </p>
        </div>
        <ThemeToggle />
      </div>
    </aside>);

}
