import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { ChevronLeftIcon, ChevronRightIcon, RadarIcon, SparklesIcon } from 'lucide-react';
import type { Fact } from '../data/scanFacts';
import { remainingPhrase } from '../data/scanFacts';
import { cn } from '../utils/cn';

interface ScanDeckProps {
  /** Facts about the section, mixed by `factsFor`. */
  facts: Fact[];
  /** Live cards built by the page from what it has found so far. */
  live?: Fact[];
  progress: {done: number;total: number;currentPath?: string;startedAt?: number;};
  unit?: string;
  /** What the deck says it is doing, e.g. "Measuring app caches". */
  label: string;
}

/** Seconds a card stays before the deck moves on by itself. */
const DWELL_MS = 6500;
const SWIPE_THRESHOLD = 90;

/**
 * The card deck shown while a page is still counting: a remaining-work card
 * every few cards, facts about the section and the machine in between. Cards
 * advance on their own, or by swipe, arrow keys and the arrows on the side.
 */
export function ScanDeck({ facts, live = [], progress, unit = 'folder', label }: ScanDeckProps) {
  const remaining = remainingPhrase(progress.done, progress.total, progress.startedAt, unit);

  // The progress card is recomputed each render, so it is inserted at draw
  // time rather than kept in state.
  const cards = useMemo<Fact[]>(() => {
    const pool = [...live, ...facts];
    const list: Fact[] = [];
    pool.forEach((fact, index) => {
      if (index % 3 === 0) list.push({ id: `progress-${index}`, kicker: 'Where it is up to', title: '', body: '', kind: 'progress' });
      list.push(fact);
    });
    if (list.length === 0) list.push({ id: 'progress-0', kicker: 'Where it is up to', title: '', body: '', kind: 'progress' });
    return list;
  }, [facts, live]);

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const [paused, setPaused] = useState(false);
  const timer = useRef<number | null>(null);

  const go = useCallback(
    (step: number) => {
      setDirection(step);
      setIndex((current) => (current + step + cards.length) % cards.length);
    },
    [cards.length]
  );

  useEffect(() => {
    if (paused) return;
    timer.current = window.setInterval(() => go(1), DWELL_MS);
    return () => {
      if (timer.current !== null) window.clearInterval(timer.current);
    };
  }, [paused, go]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'ArrowLeft') go(-1);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const current = cards[index % cards.length];
  const behind = [1, 2].map((offset) => cards[(index + offset) % cards.length]);

  function onDragEnd(_event: unknown, info: PanInfo) {
    if (info.offset.x < -SWIPE_THRESHOLD || info.velocity.x < -500) go(1);else
    if (info.offset.x > SWIPE_THRESHOLD || info.velocity.x > 500) go(-1);
  }

  return (
    <section
      aria-label={label}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="relative shrink-0 border-b border-line bg-surface px-5 py-4">

      <div className="flex items-center gap-3">
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 2.6, ease: 'linear', repeat: Infinity }}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-accent">

          <RadarIcon className="h-5 w-5" strokeWidth={1.9} />
        </motion.span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium text-ink">{label}…</p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{progress.currentPath || remaining.headline}</p>
        </div>
        <p className="shrink-0 text-right text-[12px] tabular-nums text-muted">
          {progress.total > 0 ? `${progress.done} / ${progress.total} ${unit}s` : 'finding'}
        </p>
      </div>

      <div className="relative mt-3 h-1 w-full overflow-hidden rounded-full bg-raised">
        <motion.div
          className="h-full rounded-full bg-accent"
          animate={{ width: `${Math.max(2, remaining.ratio * 100)}%` }}
          transition={{ duration: 0.3, ease: [0.23, 1, 0.32, 1] }} />

        <motion.div
          className="absolute inset-y-0 w-16 bg-gradient-to-r from-transparent via-white/30 to-transparent"
          animate={{ left: ['-20%', '110%'] }}
          transition={{ duration: 1.8, ease: 'linear', repeat: Infinity }}
          style={{ maxWidth: `${Math.max(2, remaining.ratio * 100)}%` }} />

      </div>

      <div className="relative mt-4 flex items-stretch gap-2">
        <button
          type="button"
          aria-label="Previous card"
          onClick={() => go(-1)}
          className="flex w-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

          <ChevronLeftIcon className="h-4 w-4" strokeWidth={2} />
        </button>

        <div className="relative h-[118px] min-w-0 flex-1">
          {behind.map((card, offset) =>
          <div
            key={`${card.id}-shadow-${offset}`}
            aria-hidden="true"
            className="absolute inset-x-0 rounded-xl border border-line bg-raised/70"
            style={{
              top: `${(offset + 1) * 6}px`,
              bottom: `-${(offset + 1) * 6}px`,
              transform: `scale(${1 - (offset + 1) * 0.03})`,
              opacity: 0.6 - offset * 0.25,
              zIndex: 2 - offset
            }} />

          )}

          <AnimatePresence initial={false} custom={direction} mode="popLayout">
            <motion.article
              key={current.id}
              custom={direction}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragStart={() => setPaused(true)}
              onDragEnd={(event, info) => {
                onDragEnd(event, info);
                setPaused(false);
              }}
              initial={{ x: direction > 0 ? 160 : -160, opacity: 0, rotate: direction > 0 ? 6 : -6, scale: 0.96 }}
              animate={{ x: 0, opacity: 1, rotate: 0, scale: 1 }}
              exit={{ x: direction > 0 ? -220 : 220, opacity: 0, rotate: direction > 0 ? -10 : 10, scale: 0.94 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
              className={cn(
                'absolute inset-0 z-10 cursor-grab select-none rounded-xl border p-4 active:cursor-grabbing',
                current.kind === 'progress' ? 'border-accent/30 bg-accent/5' : 'border-line bg-canvas'
              )}>

              {current.kind === 'progress' ?
              <>
                  <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-accent">
                    <RadarIcon className="h-3 w-3" strokeWidth={2.4} />
                    {current.kicker}
                  </p>
                  <p className="mt-2 text-[17px] font-semibold leading-tight tracking-tight text-ink">{remaining.headline}</p>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{remaining.detail}</p>
                </> :

              <>
                  <p className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">
                    <SparklesIcon className="h-3 w-3 text-node" strokeWidth={2.4} />
                    {current.kicker}
                  </p>
                  <p className="mt-2 text-[14.5px] font-semibold leading-tight tracking-tight text-ink">{current.title}</p>
                  <p className="mt-1.5 line-clamp-3 text-[12px] leading-relaxed text-muted">{current.body}</p>
                </>
              }
            </motion.article>
          </AnimatePresence>
        </div>

        <button
          type="button"
          aria-label="Next card"
          onClick={() => go(1)}
          className="flex w-7 shrink-0 items-center justify-center rounded-lg text-faint transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">

          <ChevronRightIcon className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      <div className="mt-2.5 flex items-center justify-center gap-1">
        {cards.slice(0, Math.min(cards.length, 12)).map((card, dot) =>
        <button
          key={card.id}
          type="button"
          aria-label={`Card ${dot + 1}`}
          onClick={() => {
            setDirection(dot > index ? 1 : -1);
            setIndex(dot);
          }}
          className={cn(
            'h-1 rounded-full transition-all duration-200 ease-swift',
            dot === index % cards.length ? 'w-4 bg-accent' : 'w-1.5 bg-line hover:bg-faint'
          )} />

        )}
      </div>
    </section>);

}

/**
 * A row that is still being measured: soft, slow-moving fog where the
 * number will be. Pure CSS — one gradient, one keyframe — so a list of a few
 * hundred of them costs nothing.
 */
export function Fog({ className }: {className?: string;}) {
  return <span aria-hidden="true" className={cn('fog inline-block rounded-md', className)} />;
}
