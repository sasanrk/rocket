/**
 * What this machine could be upgraded to, worked out from what is in it.
 *
 * The socket decides the CPU ceiling, the memory array decides the RAM
 * ceiling, and the chipset generation decides whether NVMe is even an option.
 * None of this is looked up online: it is a table of the sockets and their
 * best chips, applied to the processor name and the SMBIOS memory data.
 * Every recommendation says how sure it is and why.
 */

const GB = 1024 * 1024 * 1024

/** Intel Core generations → socket and the strongest chip that fits it. */
const INTEL = [
  { gens: [2, 3], socket: 'LGA1155', ram: 'DDR3', best: 'Core i7-3770K', bestCores: '4 cores / 8 threads', nvme: false, era: 2011 },
  { gens: [4, 5], socket: 'LGA1150', ram: 'DDR3', best: 'Core i7-4790K', bestCores: '4 cores / 8 threads, 4.4 GHz turbo', nvme: false, era: 2013 },
  { gens: [6, 7], socket: 'LGA1151', ram: 'DDR4', best: 'Core i7-7700K', bestCores: '4 cores / 8 threads', nvme: true, era: 2015 },
  { gens: [8, 9], socket: 'LGA1151 (300-series)', ram: 'DDR4', best: 'Core i9-9900K', bestCores: '8 cores / 16 threads', nvme: true, era: 2017 },
  { gens: [10, 11], socket: 'LGA1200', ram: 'DDR4', best: 'Core i9-11900K', bestCores: '8 cores / 16 threads', nvme: true, era: 2020 },
  { gens: [12, 13, 14], socket: 'LGA1700', ram: 'DDR4 or DDR5', best: 'Core i9-14900K', bestCores: '24 cores / 32 threads', nvme: true, era: 2021 },
]
const AMD = [
  { range: [1000, 5999], socket: 'AM4', ram: 'DDR4', best: 'Ryzen 7 5800X3D (gaming) or Ryzen 9 5950X (16 cores)', nvme: true, era: 2017 },
  { range: [7000, 9999], socket: 'AM5', ram: 'DDR5', best: 'Ryzen 7 9800X3D (gaming) or Ryzen 9 9950X (16 cores)', nvme: true, era: 2022 },
]

const MOBILE_SUFFIX = /\b(?:i[3579]|Ryzen [3579])[- ]?\d{3,5}(?:[A-Z]*)?(U|H|HQ|HK|HS|HX|P|G\d|Y)\b/

function intelGeneration(name) {
  const ultra = name.match(/Core\(TM\) Ultra\b/i)
  if (ultra) return { generation: 15, ultra: true }
  const match = name.match(/i[3579][- ](\d{4,5})/i)
  if (!match) return null
  const digits = match[1]
  return { generation: digits.length === 5 ? Number(digits.slice(0, 2)) : Number(digits[0]), model: digits }
}

function amdModel(name) {
  const match = name.match(/Ryzen\s+(?:[3579]|AI)\s+(?:PRO\s+)?(\d{4})/i)
  return match ? Number(match[1]) : null
}

/** Socket, RAM type and best chip for the processor in the machine. */
function identifyPlatform(cpuName, isLaptop) {
  const name = cpuName || ''
  const mobile = isLaptop || MOBILE_SUFFIX.test(name)
  if (/GenuineIntel|Intel/i.test(name)) {
    const info = intelGeneration(name)
    if (info && info.ultra) return { vendor: 'Intel', generation: 'Core Ultra', socket: mobile ? 'soldered (mobile)' : 'LGA1851', ram: 'DDR5', best: 'Core Ultra 9 285K', bestCores: '24 cores', nvme: true, mobile, era: 2024 }
    if (info) {
      const row = INTEL.find((entry) => entry.gens.includes(info.generation))
      if (row) return { vendor: 'Intel', generation: `${info.generation}th gen`, socket: mobile ? 'soldered (mobile)' : row.socket, ram: row.ram, best: mobile ? null : row.best, bestCores: row.bestCores, nvme: row.nvme, mobile, era: row.era }
      return { vendor: 'Intel', generation: `${info.generation}th gen`, socket: mobile ? 'soldered (mobile)' : 'unknown', ram: null, best: null, nvme: info.generation >= 6, mobile, era: null }
    }
    return { vendor: 'Intel', generation: null, socket: mobile ? 'soldered (mobile)' : 'unknown', ram: null, best: null, nvme: null, mobile, era: null }
  }
  if (/AMD|Ryzen/i.test(name)) {
    const model = amdModel(name)
    const row = model ? AMD.find((entry) => model >= entry.range[0] && model <= entry.range[1]) : null
    if (row) return { vendor: 'AMD', generation: `Ryzen ${String(model)[0]}000`, socket: mobile ? 'soldered (mobile)' : row.socket, ram: row.ram, best: mobile ? null : row.best, bestCores: '', nvme: row.nvme, mobile, era: row.era }
    return { vendor: 'AMD', generation: null, socket: mobile ? 'soldered (mobile)' : 'unknown', ram: null, best: null, nvme: null, mobile, era: null }
  }
  return { vendor: 'unknown', generation: null, socket: mobile ? 'soldered (mobile)' : 'unknown', ram: null, best: null, nvme: null, mobile, era: null }
}

const INTEGRATED = /Intel\(R\) (?:HD|UHD|Iris|Arc\(TM\) Graphics$)|Radeon\(TM\) (?:Vega \d+ )?Graphics|AMD Radeon Graphics$|Radeon Graphics$|Microsoft Basic/i
const WEAK_DEDICATED = /RX ?5[0-9]{2}\b|RX ?4[0-9]{2}\b|GT ?7[0-9]{2}\b|GT ?1030|GTX ?(?:7|9)[0-9]{2}\b|GTX ?10[0-5]0\b|Radeon R[579] /i

function gb(bytes) {
  return Math.round(bytes / GB)
}

function ramTypeLabel(code) {
  return { 20: 'DDR', 21: 'DDR2', 24: 'DDR3', 26: 'DDR4', 34: 'DDR5', 35: 'DDR5' }[code] || null
}

/**
 * Builds the upgrade paths. `specs` is the normalised reading from
 * system.cjs; the result is what the This PC page shows under "Upgrade paths".
 */
function adviseUpgrades(specs) {
  const advice = []
  const platform = identifyPlatform(specs.cpu.name, specs.computer.type === 'laptop')
  const modules = specs.memory.modules
  const ramType = modules.map((module) => module.type).find(Boolean) || platform.ram
  const totalGB = gb(specs.memory.totalBytes)
  const maxGB = specs.memory.maxBytes ? gb(specs.memory.maxBytes) : null
  const slots = specs.memory.slots
  const freeSlots = slots !== null ? Math.max(0, slots - modules.length) : null
  const perSlotGB = maxGB && slots ? Math.round(maxGB / slots) : null

  // ---- memory
  if (platform.mobile && modules.every((module) => module.formFactor !== 'SODIMM')) {
    advice.push({ id: 'ram', area: 'ram', tone: 'info', title: 'Memory is soldered on this laptop', why: `${totalGB} GB is what it will always have; nothing is socketed.`, suggestion: 'Keep memory-hungry work in check: fewer browser tabs, one IDE at a time.', confidence: 'medium' })
  } else if (maxGB && totalGB >= maxGB) {
    advice.push({ id: 'ram', area: 'ram', tone: 'good', title: `Memory is maxed at ${totalGB} GB`, why: `The board's memory controller stops at ${maxGB} GB.`, suggestion: 'Nothing to buy here.', confidence: 'high' })
  } else if (freeSlots && freeSlots > 0) {
    const add = perSlotGB ? Math.min(perSlotGB, maxGB ? maxGB - totalGB : perSlotGB) : 8
    advice.push({
      id: 'ram', area: 'ram', tone: 'upgrade',
      title: `Add ${add * freeSlots} GB of RAM: ${freeSlots} of ${slots} slots ${freeSlots === 1 ? 'is' : 'are'} empty`,
      why: `${totalGB} GB now, ${maxGB ? `${maxGB} GB` : 'more'} supported. One ${ramType || 'matching'} stick per free slot is the cheapest upgrade this machine can take.`,
      suggestion: `${freeSlots} × ${add} GB ${ramType || ''}${modules[0]?.speed ? `-${modules[0].speed}` : ''} ${modules[0]?.formFactor || 'DIMM'}${modules.length ? `, same speed as the ${modules[0].speed} MHz sticks already in` : ''}.`,
      confidence: 'high',
    })
  } else if (maxGB && slots && perSlotGB) {
    const small = modules.filter((module) => gb(module.bytes) < perSlotGB)
    if (small.length > 0) {
      advice.push({
        id: 'ram', area: 'ram', tone: 'upgrade',
        title: `Every slot is full, but ${maxGB - totalGB} GB more is possible`,
        why: `${small.length} of the ${slots} sticks ${small.length === 1 ? 'is' : 'are'} ${small.map((module) => `${gb(module.bytes)} GB`).join(' + ')}; each slot takes up to ${perSlotGB} GB.`,
        suggestion: `Replace the ${small.map((module) => `${gb(module.bytes)} GB`).join(' and ')} ${small.length === 1 ? 'stick' : 'sticks'} with ${perSlotGB} GB ${ramType || ''} ones to reach ${maxGB} GB.`,
        confidence: 'high',
      })
    }
  }
  const speeds = new Set(modules.map((module) => module.speed).filter(Boolean))
  const configured = modules.map((module) => module.configuredSpeed).filter(Boolean)
  if (speeds.size > 1 && configured.length > 0) {
    advice.push({ id: 'ram-speed', area: 'ram', tone: 'info', title: `Mixed memory speeds: everything runs at ${Math.min(...configured)} MHz`, why: `Sticks rated ${[...speeds].sort().join(' and ')} MHz share one bus, so the slowest sets the pace.`, suggestion: 'Not worth fixing on its own; match speeds the next time a stick is replaced.', confidence: 'high' })
  }
  if (totalGB < 16) {
    advice.push({ id: 'ram-min', area: 'ram', tone: 'upgrade', title: `${totalGB} GB is tight for today's software`, why: 'A browser with tabs, an editor and one build already reach 12 GB; after that Windows pages to disk and everything slows.', suggestion: '16 GB is the floor for development work, 32 GB if virtual machines or Docker are involved.', confidence: 'high' })
  }

  // ---- CPU
  const cpuName = specs.cpu.name || 'this processor'
  if (platform.mobile) {
    advice.push({ id: 'cpu', area: 'cpu', tone: 'info', title: 'The processor cannot be swapped', why: 'Laptop CPUs are soldered to the board.', suggestion: 'The CPU & power page gets the most out of the one you have; beyond that it is a new machine.', confidence: 'high' })
  } else if (platform.best) {
    const already = new RegExp(platform.best.split(' ').pop().replace(/[()]/g, ''), 'i').test(cpuName)
    if (already) {
      advice.push({ id: 'cpu', area: 'cpu', tone: 'good', title: `${cpuName.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').trim()} is the top chip for socket ${platform.socket}`, why: 'Nothing faster fits this board.', suggestion: 'A faster CPU means a new board, new memory and probably a new machine.', confidence: 'high' })
    } else {
      advice.push({
        id: 'cpu', area: 'cpu', tone: 'upgrade',
        title: `A ${platform.best} fits this board`,
        why: `${cpuName.replace(/\(R\)|\(TM\)|CPU|@.*$/g, '').trim()} sits in socket ${platform.socket} (${platform.vendor} ${platform.generation}). The strongest chip made for that socket is the ${platform.best}${platform.bestCores ? ` — ${platform.bestCores}` : ''}. Used ones are cheap because the platform is ${new Date().getFullYear() - (platform.era || new Date().getFullYear())} years old.`,
        suggestion: `${platform.best}. Check the board's BIOS supports it (a BIOS from ${(platform.era || 2015) + 1} or later does), and budget for a better cooler — the top chips run hot.`,
        confidence: platform.socket === 'unknown' ? 'low' : 'high',
      })
    }
  } else {
    advice.push({ id: 'cpu', area: 'cpu', tone: 'info', title: 'Could not place this processor on a socket', why: `${cpuName} is not in the table of desktop sockets.`, suggestion: 'Look up the socket on the board maker\'s page; the RAM and storage advice still holds.', confidence: 'low' })
  }

  // ---- GPU
  const gpus = specs.gpus.map((gpu) => ({ ...gpu, integrated: INTEGRATED.test(gpu.name) }))
  const dedicated = gpus.filter((gpu) => !gpu.integrated)
  if (platform.mobile) {
    if (dedicated.length === 0) advice.push({ id: 'gpu', area: 'gpu', tone: 'info', title: 'Integrated graphics only', why: 'Laptop graphics are part of the board.', suggestion: 'An external GPU over Thunderbolt is the only route, and only if the laptop has a Thunderbolt port.', confidence: 'medium' })
  } else if (dedicated.length === 0) {
    advice.push({ id: 'gpu', area: 'gpu', tone: 'upgrade', title: 'No dedicated graphics card', why: `${gpus[0]?.name || 'The integrated chip'} shares system memory and handles the desktop fine, but games, video editing and anything with AI in it crawl.`, suggestion: 'An 8 GB card of the RX 7600 / RTX 4060 class fits any PCIe x16 slot; check the power supply (450 W+) and the case length first.', confidence: 'medium' })
  } else {
    const card = dedicated[0]
    const weak = WEAK_DEDICATED.test(card.name) || (card.vramBytes && card.vramBytes <= 4 * GB)
    if (weak) {
      advice.push({ id: 'gpu', area: 'gpu', tone: 'info', title: `${card.name} is an entry-level card`, why: `${card.vramBytes ? `${gb(card.vramBytes)} GB of video memory` : 'Limited video memory'} is plenty for the desktop, video and light work; it runs out in modern games and anything that runs AI models locally.`, suggestion: 'Only worth replacing for games or GPU compute: an 8 GB+ card (RX 7600, RTX 4060) needs a 450–550 W power supply.', confidence: 'medium' })
    } else {
      advice.push({ id: 'gpu', area: 'gpu', tone: 'good', title: `${card.name} is a capable card`, why: `${card.vramBytes ? `${gb(card.vramBytes)} GB of video memory.` : ''}`, suggestion: 'Nothing to change unless a specific game or workload says otherwise.', confidence: 'medium' })
    }
  }

  // ---- storage
  const system = specs.disks.find((disk) => disk.system) || specs.disks[0]
  if (system && /HDD/i.test(system.mediaType)) {
    advice.push({ id: 'ssd', area: 'storage', tone: 'upgrade', title: 'Windows is on a hard disk — an SSD is the single biggest upgrade', why: 'Every launch, every build and every update waits on a spinning platter.', suggestion: `A 500 GB SATA SSD (about $40) makes this machine feel new; ${platform.nvme ? 'this board also takes an NVMe M.2 drive, which is faster still.' : 'this board has no M.2 slot, so SATA is the way.'}`, confidence: 'high' })
  } else if (system && /SATA/i.test(system.bus)) {
    if (platform.nvme) {
      advice.push({ id: 'nvme', area: 'storage', tone: 'info', title: 'Windows is on a SATA SSD; the board can take NVMe', why: 'SATA tops out around 550 MB/s; an NVMe drive in the M.2 slot does 3,000–7,000 MB/s.', suggestion: 'Worth it for large project trees and Docker; not noticeable for browsing.', confidence: platform.nvme === true ? 'medium' : 'low' })
    } else {
      advice.push({ id: 'nvme', area: 'storage', tone: 'good', title: 'Windows is on an SSD, which is the ceiling for this board', why: `Boards of this generation have no M.2 slot; SATA SSDs are as fast as it gets here.`, suggestion: 'More space, not more speed, is the only storage upgrade left: a larger SATA SSD.', confidence: 'medium' })
    }
  } else if (system) {
    advice.push({ id: 'nvme', area: 'storage', tone: 'good', title: `Windows is on ${system.mediaType === 'SSD' ? 'a fast SSD' : system.mediaType}`, why: `${system.name} over ${system.bus}.`, suggestion: 'Nothing to change.', confidence: 'medium' })
  }
  const tight = specs.disks.filter((disk) => disk.freeBytes !== null && disk.totalBytes > 0 && disk.freeBytes / disk.totalBytes < 0.1)
  if (tight.length > 0) {
    advice.push({ id: 'space', area: 'storage', tone: 'upgrade', title: `${tight.map((disk) => disk.letter || disk.name).join(', ')} ${tight.length === 1 ? 'is' : 'are'} nearly full`, why: 'SSDs slow down and Windows misbehaves below about 10% free.', suggestion: 'The Drives, App junk and Projects pages get space back without spending anything; after that, a bigger drive.', confidence: 'high' })
  }

  // ---- OS
  if (/Windows 11/i.test(specs.os.name) && platform.vendor === 'Intel' && /(\d+)th gen/.test(platform.generation || '') && Number(platform.generation) < 8) {
    advice.push({ id: 'os', area: 'os', tone: 'info', title: 'Windows 11 on a processor Microsoft does not list for it', why: `Windows 11 officially wants 8th-gen Intel or newer; this is ${platform.generation}. It runs, but feature updates sometimes need a manual install.`, suggestion: 'Nothing to do day to day; keep an installer handy for the next big update.', confidence: 'high' })
  } else if (/Windows 10/i.test(specs.os.name)) {
    advice.push({ id: 'os', area: 'os', tone: 'info', title: 'Windows 10 stopped getting security updates in October 2025', why: 'Nothing changes on the machine, but new holes stay open.', suggestion: 'Windows 11 if the hardware allows it, or the Extended Security Updates programme.', confidence: 'high' })
  }

  return { platform: { ...platform, ramType, ramMaxGB: maxGB, ramSlots: slots, ramFreeSlots: freeSlots }, advice }
}

module.exports = { adviseUpgrades, identifyPlatform, ramTypeLabel }
