import type { DefenderInfo, ProcessGroup, ProcessInfo, SystemSnapshot } from '../types/system';

/**
 * A believable machine for the browser preview: a four-core desktop with too
 * many browser tabs open, which is exactly the situation the Processes tab
 * exists to make legible.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

interface Seed {
  name: string;
  title?: string;
  group: ProcessGroup;
  groupLabel: string;
  copies: number;
  cpu: [number, number];
  memory: [number, number];
  priority?: string;
  commandLine?: string;
  protected?: boolean;
}

const SEEDS: Seed[] = [
{ name: 'chrome', title: 'Reclaim — Google Chrome', group: 'browser', groupLabel: 'Browsers', copies: 22, cpu: [0, 9], memory: [60 * MB, 320 * MB] },
{ name: 'msedge', group: 'browser', groupLabel: 'Browsers', copies: 6, cpu: [0, 3], memory: [40 * MB, 180 * MB] },
{ name: 'Code', title: 'reclaim — Visual Studio Code', group: 'editor', groupLabel: 'Editors & IDEs', copies: 7, cpu: [0, 6], memory: [90 * MB, 520 * MB] },
{ name: 'studio64', title: 'sentinel-android-lib', group: 'editor', groupLabel: 'Editors & IDEs', copies: 1, cpu: [1, 12], memory: [1.6 * GB, 2.4 * GB] },
{
  name: 'node',
  group: 'node',
  groupLabel: 'Node & tooling',
  copies: 5,
  cpu: [0, 14],
  memory: [40 * MB, 420 * MB],
  commandLine: '"C:\\Program Files\\nodejs\\node.exe" next dev --turbo'
},
{ name: 'esbuild', group: 'node', groupLabel: 'Node & tooling', copies: 3, cpu: [0, 2], memory: [18 * MB, 40 * MB] },
{
  name: 'java',
  title: 'Gradle Daemon',
  group: 'build',
  groupLabel: 'Builds & Android',
  copies: 2,
  cpu: [0, 24],
  memory: [700 * MB, 1.5 * GB],
  commandLine: 'java -Xmx2g org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.5'
},
{ name: 'MsMpEng', group: 'security', groupLabel: 'Antivirus & security', copies: 1, cpu: [2, 34], memory: [280 * MB, 420 * MB], protected: true },
{ name: 'svchost', group: 'system', groupLabel: 'Windows', copies: 34, cpu: [0, 1.5], memory: [6 * MB, 90 * MB], protected: true },
{ name: 'explorer', group: 'system', groupLabel: 'Windows', copies: 1, cpu: [0, 4], memory: [110 * MB, 190 * MB], protected: true },
{ name: 'dwm', group: 'system', groupLabel: 'Windows', copies: 1, cpu: [1, 7], memory: [140 * MB, 220 * MB], priority: 'High', protected: true },
{ name: 'SearchIndexer', group: 'system', groupLabel: 'Windows', copies: 1, cpu: [0, 9], memory: [40 * MB, 120 * MB], protected: true },
{ name: 'Docker Desktop', group: 'other', groupLabel: 'Other', copies: 4, cpu: [0, 3], memory: [60 * MB, 400 * MB] }];


function between([low, high]: [number, number]): number {
  return low + Math.random() * (high - low);
}

let pidSeed = 1000;

/** Regenerated on every call so the preview's numbers move like a real one. */
export function mockSnapshot(): SystemSnapshot {
  const processes: ProcessInfo[] = [];
  pidSeed = 1000;

  SEEDS.forEach((seed) => {
    for (let copy = 0; copy < seed.copies; copy += 1) {
      pidSeed += Math.floor(1 + Math.random() * 40);
      processes.push({
        pid: pidSeed,
        name: seed.name,
        title: copy === 0 && seed.title ? seed.title : '',
        group: seed.group,
        groupLabel: seed.groupLabel,
        cpu: Math.round(between(seed.cpu) * 10) / 10,
        memoryBytes: Math.round(between(seed.memory)),
        priority: seed.priority ?? 'Normal',
        threads: Math.round(4 + Math.random() * 40),
        startedAt: new Date(Date.now() - Math.random() * 6 * 3600 * 1000).toISOString(),
        commandLine: seed.commandLine ?? '',
        protected: Boolean(seed.protected),
        isSelf: false
      });
    }
  });

  const totalMemory = 20 * GB;
  const usedMemory = processes.reduce((sum, process) => sum + process.memoryBytes, 0) + 2.4 * GB;
  const cpuPercent = Math.min(100, Math.round(processes.reduce((sum, process) => sum + process.cpu, 0) * 10) / 10);

  return {
    at: new Date().toISOString(),
    cores: 4,
    sampleMs: 2000,
    cpuPercent,
    memory: { totalBytes: totalMemory, usedBytes: usedMemory, freeBytes: totalMemory - usedMemory },
    uptimeSeconds: 4 * 3600 + 40 * 60,
    disks: [
    { root: 'C:\\', totalBytes: 222.7 * GB, freeBytes: 33.5 * GB },
    { root: 'D:\\', totalBytes: 111.2 * GB, freeBytes: 6.6 * GB },
    { root: 'F:\\', totalBytes: 1863 * GB, freeBytes: 1090 * GB }],

    processes
  };
}

export function mockDefender(): DefenderInfo {
  return {
    available: true,
    running: true,
    memoryMB: 331,
    realTimeProtection: true,
    behaviorMonitor: true,
    scanInProgress: false,
    cpuLoadFactor: 50,
    onlyWhenIdle: true,
    catchUpQuick: false,
    catchUpFull: false,
    lastQuickScan: new Date(Date.now() - 20 * 3600 * 1000).toISOString(),
    tamperProtected: true,
    exclusions: ['C:\\Development', 'D:\\Dev'],
    exclusionProcess: [],
    devPaths: [
    { path: 'C:\\Users\\dev\\AppData\\Local\\Temp', label: 'Temp files', covered: false },
    { path: 'C:\\Users\\dev\\AppData\\Roaming\\npm-cache', label: 'npm cache', covered: false },
    { path: 'C:\\Users\\dev\\AppData\\Local\\pnpm', label: 'pnpm store', covered: false },
    { path: 'C:\\Users\\dev\\.gradle', label: 'Gradle cache', covered: true },
    { path: 'C:\\Users\\dev\\.vscode\\extensions', label: 'VS Code extensions', covered: false }]

  };
}
