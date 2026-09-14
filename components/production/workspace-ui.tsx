'use client';
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

export function WorkspaceTabs({
  tabs,
  value,
  onChange,
  label = 'Workspace sections',
}: {
  tabs: string[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <nav className="workspace-tabs" aria-label={label}>
      {tabs.map((tab) => (
        <Button
          key={tab}
          variant="ghost"
          aria-current={value === tab ? 'page' : undefined}
          className={value === tab ? 'active' : ''}
          onClick={() => onChange(tab)}
        >
          {tab}
        </Button>
      ))}
    </nav>
  );
}
export const SectionTabs = WorkspaceTabs;
const SectionContext = createContext('');
export function InspectorSection({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return useContext(SectionContext) === name ? (
    <div className="inspector-section">{children}</div>
  ) : null;
}
export function InspectorPanel({
  title,
  sections,
  children,
  onClose,
  onPrevious,
  onNext,
  actions,
}: {
  title: string;
  sections: string[];
  children: ReactNode;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  actions?: ReactNode;
}) {
  const [section, setSection] = useState(sections[0]);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (window.matchMedia('(max-width: 767px)').matches)
      closeRef.current?.focus();
  }, []);
  return (
    <aside
      className="inspector-panel"
      aria-label={`${title} inspector`}

    >
      <header className="inspector-heading">
        <Button
          ref={closeRef}
          className="inspector-back"
          variant="ghost"
          onClick={onClose}
          aria-label="Back to records"
        >
          <ArrowLeft size={16} />
        </Button>
        <div>
          <b>{title}</b>
          <small>Autosaved with project</small>
        </div>
        <div className="inspector-step">
          <Button
            variant="ghost"
            disabled={!onPrevious}
            onClick={onPrevious}
            aria-label="Previous record"
          >
            <ChevronLeft size={16} />
          </Button>
          <Button
            variant="ghost"
            disabled={!onNext}
            onClick={onNext}
            aria-label="Next record"
          >
            <ChevronRight size={16} />
          </Button>
          <Button
            variant="ghost"
            onClick={onClose}
            aria-label="Close inspector"
          >
            <X size={16} />
          </Button>
        </div>
      </header>
      <SectionTabs
        tabs={sections}
        value={sections.includes(section) ? section : sections[0]}
        onChange={setSection}
        label="Inspector sections"
      />
      <div className="inspector-body">
        <SectionContext.Provider
          value={sections.includes(section) ? section : sections[0]}
        >
          {children}
        </SectionContext.Provider>
      </div>
      {actions && <footer className="inspector-actions">{actions}</footer>}
    </aside>
  );
}
export function StatusBadge({
  children,
  warning = false,
}: {
  children: ReactNode;
  warning?: boolean;
}) {
  return (
    <span className={`production-badge${warning ? ' warning' : ''}`}>
      {children}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="production-empty">
      <b>{title}</b>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}
export function CollapsibleSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="compact-disclosure">
      <summary>{title}</summary>
      {children}
    </details>
  );
}
export function CompactField({
  title,
  value,
  onChange,
  type = 'text',
  multiline = false,
}: {
  title: string;
  value?: string | number;
  onChange: (v: string) => void;
  type?: string;
  multiline?: boolean;
}) {
  return (
    <label className="prod-field">
      <span>{title}</span>
      {multiline ? (
        <Textarea
          rows={2}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          type={type}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}
export type PickerOption = { id: string; name: string };
export function EntityPicker({
  title,
  values,
  options,
  onChange,
}: {
  title: string;
  values: string[];
  options: PickerOption[];
  onChange: (values: string[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const matches = options.filter((o) =>
    o.name.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="entity-picker">
      <span>{title}</span>
      <div className="entity-chips">
        {values.map((id) => (
          <button
            type="button"
            key={id}
            onClick={() => onChange(values.filter((v) => v !== id))}
            aria-label={`Remove ${options.find((o) => o.id === id)?.name ?? 'missing record'}`}
          >
            {options.find((o) => o.id === id)?.name ?? 'Missing record'}{' '}
            <X size={12} />
          </button>
        ))}
      </div>
      <Button
        variant="outline"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        Choose {title.toLowerCase()} · {values.length}
      </Button>
      {open && (
        <div className="entity-picker-options">
          <Input
            aria-label={`Search ${title.toLowerCase()}`}
            placeholder="Search…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div>
            {matches.map((o) => (
              <label key={o.id}>
                <input
                  type="checkbox"
                  checked={values.includes(o.id)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? [...values, o.id]
                        : values.filter((id) => id !== o.id),
                    )
                  }
                />
                {o.name}
              </label>
            ))}
            {!matches.length && <p>No matches.</p>}
          </div>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Done
          </Button>
        </div>
      )}
    </div>
  );
}
export type DirectoryRow = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
};
export function RecordWorkspace({
  rows,
  selectedId,
  onSelect,
  children,
  empty,
  toolbar,
}: {
  rows: DirectoryRow[];
  selectedId: string;
  onSelect: (id: string) => void;
  children?: ReactNode;
  empty: ReactNode;
  toolbar?: ReactNode;
}) {
  const [query, setQuery] = useState('');
  const matches = rows.filter((r) =>
    `${r.title} ${r.subtitle ?? ''}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const selected = rows.some((r) => r.id === selectedId);
  return (
    <div className={`record-workspace${selected ? ' has-selection' : ''}`}>
      <section className="record-master" aria-label="Production records">
        <div className="record-toolbar">
          <div className="directory-search">
            <Search size={15} />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search records"
              placeholder="Search…"
            />
          </div>
          {toolbar}
        </div>
        {!rows.length ? (
          empty
        ) : matches.length ? (
          <div className="record-list">
            {matches.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`record-row${selectedId === r.id ? ' selected' : ''}`}
                onClick={() => onSelect(r.id)}
                aria-pressed={selectedId === r.id}
              >
                {r.icon && <span className="record-avatar">{r.icon}</span>}
                <span className="record-copy">
                  <strong>{r.title}</strong>
                  {r.subtitle && <span>{r.subtitle}</span>}
                  {r.meta && <small>{r.meta}</small>}
                </span>
                {r.badge}
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No matches"
            description="Try a different search."
          />
        )}
      </section>
      {selected ? (
        children
      ) : (
        <aside className="inspector-placeholder">
          Select a record to inspect its details.
        </aside>
      )}
    </div>
  );
}
