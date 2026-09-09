import type { SystemReport } from '../types/specs';

const GB = 1024 * 1024 * 1024;

/** The preview's machine: the same four-core desktop the rest of the mock data describes. */
export function mockSystemReport(): SystemReport {
  return {
    tookMs: 1200,
    specs: {
      computer: { manufacturer: 'Hewlett-Packard', model: 'HP EliteDesk 800 G1 TWR', family: '103C_53307F G=D', type: 'desktop' },
      os: { name: 'Microsoft Windows 11 Pro', version: '10.0.26100', build: '26100', arch: '64-bit', installedAt: '2025-09-30T18:49:43.000Z' },
      board: { manufacturer: 'Hewlett-Packard', product: '18E4', version: '', bios: 'L01 v02.71', biosDate: '2017-05-09T00:00:00.000Z' },
      cpu: { name: 'Intel(R) Core(TM) i5-4590 CPU @ 3.30GHz', cores: 4, threads: 4, maxMHz: 3301, socket: 'SOCKET 0', l2KB: 1024, l3KB: 6144 },
      memory: {
        totalBytes: 20 * GB,
        maxBytes: 32 * GB,
        slots: 4,
        modules: [
        { slot: 'DIMM1', bank: 'BANK 0', bytes: 8 * GB, speed: 1333, configuredSpeed: 1333, type: 'DDR3', formFactor: 'DIMM', manufacturer: 'Kingston', partNumber: '99U5471-040.A00LF' },
        { slot: 'DIMM2', bank: 'BANK 1', bytes: 4 * GB, speed: 1600, configuredSpeed: 1333, type: 'DDR3', formFactor: 'DIMM', manufacturer: 'Kingston', partNumber: '99P5471-049.A00LF' },
        { slot: 'DIMM3', bank: 'BANK 2', bytes: 4 * GB, speed: 1600, configuredSpeed: 1333, type: 'DDR3', formFactor: 'DIMM', manufacturer: 'Micron', partNumber: '8KTF51264AZ-1G6E1' },
        { slot: 'DIMM4', bank: 'BANK 3', bytes: 4 * GB, speed: 1600, configuredSpeed: 1333, type: 'DDR3', formFactor: 'DIMM', manufacturer: 'Hynix/Hyundai', partNumber: 'HMT451U6BFR8A-PB' }]

      },
      gpus: [
      { name: 'Radeon RX550/550 Series', vramBytes: 4 * GB, driver: '31.0.12027.9001', resolution: '1920 x 1080' },
      { name: 'Intel(R) HD Graphics 4600', vramBytes: 1 * GB, driver: '20.19.15.5126', resolution: '1920 x 1080' }],

      disks: [
      { name: 'WDC WDS120G2G0A-00JH30', mediaType: 'SSD', bus: 'SATA', bytes: 120 * GB, health: 'Healthy', system: true, letter: 'C:', totalBytes: 111 * GB, freeBytes: 8.2 * GB },
      { name: 'WD Green 2.5 240GB', mediaType: 'SSD', bus: 'SATA', bytes: 240 * GB, health: 'Healthy', system: false, letter: 'D:', totalBytes: 223 * GB, freeBytes: 4.2 * GB }],

      network: [
      { name: 'Intel(R) Ethernet Connection I217-LM', speedBps: 1_000_000_000, up: false },
      { name: 'Realtek 8723DU Wireless LAN 802.11n USB NIC', speedBps: 72_200_000, up: true }],

      monitors: [{ name: 'HP EliteDisplay E221 LED Backlit Monitor', width: 1920, height: 1080 }]
    },
    platform: { vendor: 'Intel', generation: '4th gen', socket: 'LGA1150', ram: 'DDR3', ramType: 'DDR3', ramMaxGB: 32, ramSlots: 4, ramFreeSlots: 0, best: 'Core i7-4790K', nvme: false, mobile: false, era: 2013 },
    advice: [
    { id: 'ram', area: 'ram', tone: 'upgrade', title: 'Every slot is full, but 12 GB more is possible', why: '3 of the 4 sticks are 4 GB + 4 GB + 4 GB; each slot takes up to 8 GB.', suggestion: 'Replace the 4 GB and 4 GB and 4 GB sticks with 8 GB DDR3 ones to reach 32 GB.', confidence: 'high' },
    { id: 'ram-speed', area: 'ram', tone: 'info', title: 'Mixed memory speeds: everything runs at 1333 MHz', why: 'Sticks rated 1333 and 1600 MHz share one bus, so the slowest sets the pace.', suggestion: 'Not worth fixing on its own; match speeds the next time a stick is replaced.', confidence: 'high' },
    { id: 'cpu', area: 'cpu', tone: 'upgrade', title: 'A Core i7-4790K fits this board', why: 'Intel Core i5-4590 sits in socket LGA1150 (Intel 4th gen). The strongest chip made for that socket is the Core i7-4790K — 4 cores / 8 threads, 4.4 GHz turbo. Used ones are cheap because the platform is 13 years old.', suggestion: 'Core i7-4790K. Check the board\'s BIOS supports it, and budget for a better cooler.', confidence: 'high' },
    { id: 'gpu', area: 'gpu', tone: 'info', title: 'Radeon RX550/550 Series is an entry-level card', why: '4 GB of video memory is plenty for the desktop, video and light work; it runs out in modern games and anything that runs AI models locally.', suggestion: 'Only worth replacing for games or GPU compute: an 8 GB+ card (RX 7600, RTX 4060) needs a 450–550 W power supply.', confidence: 'medium' },
    { id: 'nvme', area: 'storage', tone: 'good', title: 'Windows is on an SSD, which is the ceiling for this board', why: 'Boards of this generation have no M.2 slot; SATA SSDs are as fast as it gets here.', suggestion: 'More space, not more speed, is the only storage upgrade left: a larger SATA SSD.', confidence: 'medium' },
    { id: 'space', area: 'storage', tone: 'upgrade', title: 'C:, D: are nearly full', why: 'SSDs slow down and Windows misbehaves below about 10% free.', suggestion: 'The Drives, App junk and Projects pages get space back without spending anything; after that, a bigger drive.', confidence: 'high' },
    { id: 'os', area: 'os', tone: 'info', title: 'Windows 11 on a processor Microsoft does not list for it', why: 'Windows 11 officially wants 8th-gen Intel or newer; this is 4th gen. It runs, but feature updates sometimes need a manual install.', suggestion: 'Nothing to do day to day; keep an installer handy for the next big update.', confidence: 'high' }]

  };
}
