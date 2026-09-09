'use client';
import { useRef, useState } from 'react';
import { Upload, Download, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  importTemplate,
  prepareImport,
  type ImportPlan,
  type ImportTab,
} from '@/lib/imports';
import type { Project } from '@/lib/project';
export default function ImportWorkspace({
  tab,
  project,
  scope,
  onImport,
}: {
  tab: ImportTab;
  project: Project;
  scope: string;
  onImport: (plan: ImportPlan) => void;
}) {
  const [open, setOpen] = useState(false),
    [source, setSource] = useState(''),
    [error, setError] = useState(''),
    [plan, setPlan] = useState<ImportPlan | null>(null),
    [busy, setBusy] = useState(false),
    [filename, setFilename] = useState('');
  const readVersion = useRef(0);
  function template() {
    const blob = new Blob(
      [JSON.stringify(importTemplate(tab, project), null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download =
      'draft-it-' + tab.toLowerCase().replaceAll(' ', '-') + '-template.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function edit(text: string) {
    readVersion.current++;
    setBusy(false);
    setSource(text);
    setPlan(null);
    setError('');
    setFilename('');
  }
  async function file(f?: File) {
    if (!f) return;
    const version = ++readVersion.current;
    setPlan(null);
    setSource('');
    setError('');
    setBusy(true);
    setFilename(f.name);
    try {
      if (f.size > 50 * 1024 * 1024)
        throw Error('Choose a JSON file under 50 MB.');
      const text = await f.text();
      if (version === readVersion.current) setSource(text);
    } catch (e) {
      if (version === readVersion.current)
        setError(e instanceof Error ? e.message : 'Could not read the file.');
    } finally {
      if (version === readVersion.current) setBusy(false);
    }
  }
  function preview() {
    try {
      if (source.length > 50 * 1024 * 1024)
        throw Error('Import text must be under 50 MB.');
      setPlan(prepareImport(source, tab, project));
      setError('');
    } catch (e) {
      setPlan(null);
      setError(e instanceof Error ? e.message : 'Could not read this import.');
    }
  }
  function apply() {
    try {
      const latest = prepareImport(source, tab, project);
      onImport(latest);
      setOpen(false);
      setSource('');
      setPlan(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
      setPlan(null);
    }
  }
  return (
    <>
      <Button variant="outline" onClick={template}>
        <Download size={15} />
        Download template
      </Button>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true);
          setPlan(null);
          setError('');
        }}
      >
        <Upload size={15} />
        Import
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            readVersion.current++;
            setBusy(false);
          }
        }}
      >
        <DialogContent className="import-dialog">
          <DialogTitle>
            Import {tab === 'Export' ? 'project or backup' : tab.toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            {tab === 'Export'
              ? 'Restore into a new project, including all episodes in a series.'
              : scope + ' · Only this workspace will change.'}
          </DialogDescription>
          <div className="import-how">
            <b>AI → template → your workspace</b>
            <p>
              Download the template, give it to your AI with your writing brief,
              and ask it to return the completed JSON. Upload that file or paste
              the JSON below.
            </p>
            <Button variant="outline" onClick={template}>
              <Download size={14} />
              Download {tab.toLowerCase()} template
            </Button>
          </div>
          <label
            className="import-file"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              file(e.dataTransfer.files[0]);
            }}
          >
            <Upload size={20} />
            <span>
              {busy
                ? 'Reading file…'
                : filename || 'Choose or drop a JSON file'}
            </span>
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => file(e.target.files?.[0])}
            />
          </label>
          <label className="field">
            <span>Or paste the completed JSON</span>
            <Textarea
              value={source}
              onChange={(e) => edit(e.target.value)}
              rows={5}
              spellCheck={false}
              placeholder={'{ "schema": "draft-it-import", "version": 1, … }'}
            />
          </label>
          {error && (
            <p className="import-error" role="alert">
              {error}
            </p>
          )}
          {plan && (
            <section className="import-preview">
              <h3>Review import</h3>
              <p>{plan.summary}</p>
              <ul>
                {plan.items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
              {(tab === 'Screenplay' || tab === 'Scene cards') && (
                <details>
                  <summary>Read the imported screenplay</summary>
                  {plan.project.scenes.slice(project.scenes.length).map((s) => (
                    <div key={s.id} className="import-script">
                      {s.blocks.map((b) => (
                        <p key={b.id}>
                          <small>{b.type.replace('_', ' ')}</small>
                          {b.content}
                        </p>
                      ))}
                    </div>
                  ))}
                </details>
              )}
            </section>
          )}
          <div className="import-footer">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {plan ? (
              <button className="primary" onClick={apply}>
                <Check size={15} />
                Confirm import
              </button>
            ) : (
              <button
                className="primary"
                onClick={preview}
                disabled={busy || !source.trim()}
              >
                Preview import
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
