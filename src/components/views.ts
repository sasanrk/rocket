/** Every screen the sidebar can open, and what the page header says about it. */
export type ViewId =
'home' |
'projects' |
'apps' |
'programs' |
'drives' |
'power' |
'startup' |
'services' |
'performance' |
'processes' |
'antivirus' |
'system' |
'history';

export interface ViewMeta {
  title: string;
  description: string;
}

export const VIEW_META: Record<ViewId, ViewMeta> = {
  home: { title: 'Overview', description: 'What this machine is carrying, and what can be done about it.' },
  projects: {
    title: 'Project folders',
    description: 'Every drive is scanned for projects; delete what the tooling rebuilds, or move a whole project to another drive.'
  },
  drives: {
    title: 'Drives',
    description: 'What is taking the space on each drive, folder by folder, biggest first.'
  },
  programs: {
    title: 'Installed programs',
    description: 'Everything in Add/Remove and the Store, with its size — uninstall, then sweep what it left behind.'
  },
  apps: {
    title: 'App junk',
    description: 'Caches, logs, crash reports and temp files installed programs leave behind and recreate on demand.'
  },
  power: {
    title: 'CPU & power',
    description: 'The power-plan settings that decide how fast the processor is allowed to run.'
  },
  startup: {
    title: 'Startup programs',
    description: 'Everything Windows launches at sign-in. Each one keeps a slice of the CPU and memory for itself.'
  },
  services: {
    title: 'Background services',
    description: 'Windows services that read the disk and burn CPU on your behalf, whether you asked or not.'
  },
  performance: {
    title: 'Performance',
    description: 'CPU, memory, drives, and the handful of things actually worth acting on right now.'
  },
  processes: {
    title: 'Processes',
    description: 'Every running program, grouped by what it is, with priority control and an end button.'
  },
  antivirus: {
    title: 'Antivirus',
    description: 'What real-time scanning costs a build machine, and the folders still being inspected on every write.'
  },
  system: {
    title: 'This PC',
    description: 'Everything in the box, and what the board could take instead: a stronger CPU, more memory, faster storage.'
  },
  history: { title: 'History', description: 'Every scan and cleanup this machine has done, and what each one bought back.' }
};
