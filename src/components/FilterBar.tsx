import { motion } from 'framer-motion';
import { FolderIcon, HardDriveIcon, Loader2Icon, SearchIcon, XIcon } from 'lucide-react';
import { useCleaner } from '../contexts/CleanerContext';
import type { KindFilter, SortKey } from '../types/project';
import { cn } from '../utils/cn';

const KIND_FILTERS: {value: KindFilter;label: string;}[] = [
{ value: 'all', label: 'All' },
{ value: 'node', label: 'Node & React' },
{ value: 'android', label: 'Android' }];


const SORTS: {value: SortKey;label: string;}[] = [
{ value: 'reclaimable', label: 'Reclaimable space' },
{ value: 'total', label: 'Project size' },
{ value: 'recent', label: 'Last modified' },
{ value: 'name', label: 'Name' }];


export function FilterBar() {
  const { filter, setFilter, sort, setSort, query, setQuery, selectAllVisible, clearSelection, selected, roots, rootFilter, setRootFilter, removeIncluded } =
  useCleaner();

  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-6 py-3">
      {roots.length > 1 &&
      <div className="flex items-center gap-1">
          <button
          type="button"
          onClick={() => setRootFilter('all')}
          className={cn('rounded-lg px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-150 ease-swift', rootFilter === 'all' ? 'bg-raised text-ink' : 'text-faint hover:text-muted')}>

            Everywhere
          </button>
          {roots.map((entry) =>
        <span key={entry.path} className="group flex items-center">
              <button
            type="button"
            onClick={() => setRootFilter(entry.path)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 font-mono text-[11.5px] transition-colors duration-150 ease-swift',
              rootFilter === entry.path ? 'bg-raised text-ink' : 'text-faint hover:text-muted'
            )}
            title={entry.path}>

                {entry.status === 'running' || entry.status === 'queued' ?
            <Loader2Icon className="h-3 w-3 animate-spin text-accent" strokeWidth={2.4} /> :
            entry.kind === 'drive' ?
            <HardDriveIcon className="h-3 w-3" strokeWidth={2} /> :
            <FolderIcon className="h-3 w-3" strokeWidth={2} />}
                {entry.kind === 'drive' ? entry.path : entry.path.split('\\').filter(Boolean).pop()}
              </button>
              {entry.kind === 'folder' &&
          <button
            type="button"
            aria-label={`Stop scanning ${entry.path}`}
            onClick={() => removeIncluded(entry.path)}
            className="hidden rounded p-0.5 text-faint hover:text-danger group-hover:block">

                  <XIcon className="h-3 w-3" strokeWidth={2.4} />
                </button>
          }
            </span>
        )}
          <span className="mx-1 h-4 w-px bg-line" />
        </div>
      }
      <div role="tablist" aria-label="Filter by project type" className="flex items-center gap-1">
        {KIND_FILTERS.map(({ value, label }) => {
          const isActive = filter === value;
          return (
            <button
              key={value}
              role="tab"
              aria-selected={isActive}
              type="button"
              onClick={() => setFilter(value)}
              className={cn(
                'relative rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors duration-150 ease-swift',
                isActive ? 'text-ink' : 'text-faint hover:text-muted'
              )}>
              
              {isActive &&
              <motion.span
                layoutId="filter-pill"
                transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                className="absolute inset-0 rounded-lg border border-line bg-raised" />

              }
              <span className="relative">{label}</span>
            </button>);

        })}
      </div>

      <div className="relative ml-2 w-[240px]">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter projects"
          aria-label="Filter projects by name"
          className="h-8 w-full rounded-lg border border-line bg-raised pl-8 pr-7 text-[12px] text-ink placeholder:text-faint focus:border-accent focus:outline-none" />
        
        {query &&
        <button
          type="button"
          aria-label="Clear filter"
          onClick={() => setQuery('')}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-faint transition-colors duration-150 ease-swift hover:text-ink">
          
            <XIcon className="h-3 w-3" strokeWidth={2.4} />
          </button>
        }
      </div>

      <div className="ml-auto flex items-center gap-3">
        <label className="flex items-center gap-2 text-[12px] text-faint">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortKey)}
            className="h-8 rounded-lg border border-line bg-raised px-2 text-[12px] text-ink focus:border-accent focus:outline-none">
            
            {SORTS.map(({ value, label }) =>
            <option key={value} value={value}>
                {label}
              </option>
            )}
          </select>
        </label>

        <button
          type="button"
          onClick={selected.size > 0 ? clearSelection : selectAllVisible}
          className="rounded-lg border border-line px-2.5 py-1.5 text-[12px] font-medium text-muted transition-colors duration-150 ease-swift hover:bg-raised hover:text-ink">
          
          {selected.size > 0 ? 'Clear selection' : 'Select all safe'}
        </button>
      </div>
    </div>);

}