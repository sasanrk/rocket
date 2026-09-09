import { useEffect, useState } from 'react';
import { animate, useMotionValue, useReducedMotion } from 'framer-motion';
import { splitBytes } from '../utils/format';

interface AnimatedBytesProps {
  bytes: number;
  className?: string;
  unitClassName?: string;
}

export function AnimatedBytes({ bytes, className, unitClassName }: AnimatedBytesProps) {
  const { scaled, unit, decimals } = splitBytes(bytes);
  const reducedMotion = useReducedMotion();
  const value = useMotionValue(0);
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (reducedMotion) {
      setDisplay(scaled);
      return;
    }
    const controls = animate(value, scaled, {
      duration: 0.55,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (latest) => setDisplay(latest)
    });
    return () => controls.stop();
  }, [scaled, reducedMotion, value]);

  return (
    <span className={className}>
      <span className="tabular-nums">{display.toFixed(decimals)}</span>
      <span className={unitClassName}>{unit}</span>
    </span>);

}