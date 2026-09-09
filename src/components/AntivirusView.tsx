import { useEffect, useMemo } from 'react';
import { ActivityIcon } from 'lucide-react';
import { useMachine, useMachineWatch } from '../contexts/MachineContext';
import { DefenderPanel } from './DefenderPanel';

/** The antivirus settings that decide how a build machine feels, on their own page. */
export function AntivirusView() {
  useMachineWatch();
  const { snapshot, defender, refreshDefender, setDefender } = useMachine();

  useEffect(() => {
    void refreshDefender();
  }, [refreshDefender]);

  const engine = useMemo(
    () => snapshot?.processes.find((process) => process.name.toLowerCase() === 'msmpeng') ?? null,
    [snapshot]
  );

  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="flex items-center gap-2 text-[13px] text-faint">
          <ActivityIcon className="h-4 w-4 animate-pulse" strokeWidth={1.8} />
          Taking a reading…
        </p>
      </div>);

  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto scroll-slim p-5">
      <DefenderPanel defender={defender} engine={engine} processes={snapshot.processes} onChanged={setDefender} />
    </div>);

}
