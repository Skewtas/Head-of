import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCw,
  Target,
  Trash2,
  X,
} from 'lucide-react';
import { api } from './lib/api';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Period = 'YEAR' | 'MONTH' | 'WEEK';
type Section = 'PIPELINE' | 'ACTION' | 'PERSONAL';
type Status = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'DONE' | 'CANCELLED';

interface OpsGoal {
  id: number;
  periodType: Period;
  periodStart: string;
  periodEnd: string;
  metricKey: string;
  metricLabel: string;
  targetValue: number;
  actualOverride: number | null;
  unit: string | null;
  sortOrder: number;
}

interface OpsTask {
  id: number;
  section: Section;
  owner: string | null;
  title: string;
  nextStep: string | null;
  relatedTo: string | null;
  status: Status;
  deadline: string | null;
  notes: string | null;
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

export default function OpsView() {
  return (
    <div className="space-y-8">
      <GoalsBlock />
      <TasksBlock section="PIPELINE" title="Pipeline" />
      <TasksBlock section="ACTION" title="Actionlista" />
      <TasksBlock section="PERSONAL" title="Personliga tasks" groupByOwner />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────────────────

function GoalsBlock() {
  const [goals, setGoals] = useState<OpsGoal[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch both month and week in parallel
      const [m, w] = await Promise.all([
        api<OpsGoal[]>(`/api/ops/goals?periodType=MONTH`),
        api<OpsGoal[]>(`/api/ops/goals?periodType=WEEK`),
      ]);
      setGoals([...m, ...w]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const seed = async () => {
    if (!confirm('Importera årsmål + månadsmål från Excel?')) return;
    const r = await api<{ created: number; skipped: number }>(`/api/ops/seed`, { method: 'POST' });
    alert(`Skapade ${r.created} mål, hoppade över ${r.skipped} som redan fanns.`);
    reload();
  };

  // Filter to CURRENT month + week
  const now = new Date();
  const currentMonth = goals.filter(
    (g) =>
      g.periodType === 'MONTH' &&
      new Date(g.periodStart) <= now &&
      now <= new Date(g.periodEnd)
  );
  const currentWeek = goals.filter((g) => {
    if (g.periodType !== 'WEEK') return false;
    return new Date(g.periodStart) <= now && now <= new Date(g.periodEnd);
  });

  return (
    <section className="space-y-4">
      <header className="flex items-center gap-2">
        <Target className="w-4 h-4 text-brand-accent" />
        <h2 className="text-lg font-serif text-brand-dark">Mål</h2>
        <button
          onClick={seed}
          className="ml-auto flex items-center gap-1 text-xs text-gray-500 hover:text-brand-dark"
        >
          <RotateCw className="w-3 h-3" /> Importera Excel-mål
        </button>
      </header>

      <GoalGroup
        label={`Den här månaden — ${now.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' })}`}
        items={currentMonth}
        loading={loading}
        onReload={reload}
        defaultPeriod="MONTH"
      />
      <GoalGroup
        label={`Den här veckan — v.${isoWeek(now)}`}
        items={currentWeek}
        loading={loading}
        onReload={reload}
        defaultPeriod="WEEK"
      />
    </section>
  );
}

function GoalGroup({
  label,
  items,
  loading,
  onReload,
  defaultPeriod,
}: {
  label: string;
  items: OpsGoal[];
  loading: boolean;
  onReload: () => void;
  defaultPeriod: Period;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', target: '', unit: 'kr' as 'kr' | 'st' | '%' });

  const addGoal = async () => {
    if (!draft.label.trim() || !draft.target.trim()) return;
    const now = new Date();
    let ps: Date, pe: Date;
    if (defaultPeriod === 'MONTH') {
      ps = new Date(now.getFullYear(), now.getMonth(), 1);
      pe = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    } else {
      ps = startOfISOWeek(now);
      pe = new Date(ps);
      pe.setDate(pe.getDate() + 6);
    }
    await api(`/api/ops/goals`, {
      method: 'POST',
      body: JSON.stringify({
        periodType: defaultPeriod,
        periodStart: ps.toISOString().slice(0, 10),
        periodEnd: pe.toISOString().slice(0, 10),
        metricKey: 'custom',
        metricLabel: draft.label.trim(),
        targetValue: Number(draft.target.replace(',', '.')) || 0,
        unit: draft.unit,
        sortOrder: items.length + 1,
      }),
    });
    setDraft({ label: '', target: '', unit: draft.unit });
    setAdding(false);
    onReload();
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-600 flex items-center gap-2">
        <CalendarIcon className="w-3 h-3" />
        {label}
      </div>
      {loading ? (
        <div className="px-4 py-6 text-sm text-gray-400">Laddar…</div>
      ) : items.length === 0 && !adding ? (
        <div className="px-4 py-6 text-sm text-gray-400 italic text-center">
          Inga mål satta för denna period.
        </div>
      ) : (
        items
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((g) => <GoalRow key={g.id} goal={g} onReload={onReload} />)
      )}
      {adding ? (
        <div className="px-4 py-3 flex items-center gap-2 border-t border-gray-100 bg-gray-50/50">
          <input
            autoFocus
            value={draft.label}
            onChange={(e) => setDraft({ ...draft, label: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addGoal()}
            placeholder="Etikett (t.ex. Fakturerad försäljning)"
            className="flex-1 text-sm bg-transparent border-b border-gray-200 outline-none focus:border-brand-accent py-1"
          />
          <input
            value={draft.target}
            onChange={(e) => setDraft({ ...draft, target: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && addGoal()}
            placeholder="Mål"
            className="w-28 text-sm bg-transparent border-b border-gray-200 outline-none focus:border-brand-accent py-1 text-right"
          />
          <select
            value={draft.unit}
            onChange={(e) => setDraft({ ...draft, unit: e.target.value as any })}
            className="text-xs bg-transparent border-b border-gray-200 outline-none py-1"
          >
            <option value="kr">kr</option>
            <option value="st">st</option>
            <option value="%">%</option>
          </select>
          <button onClick={addGoal} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              setAdding(false);
              setDraft({ label: '', target: '', unit: draft.unit });
            }}
            className="p-1 text-gray-400 hover:bg-gray-100 rounded"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="px-4 py-2 w-full text-left text-xs text-gray-400 hover:text-brand-accent border-t border-gray-100 flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Lägg till mål
        </button>
      )}
    </div>
  );
}

function GoalRow({ goal, onReload }: { goal: OpsGoal; onReload: () => void }) {
  const [editingActual, setEditingActual] = useState(false);
  const [draftActual, setDraftActual] = useState(
    goal.actualOverride != null ? String(goal.actualOverride) : ''
  );

  const actual = goal.actualOverride ?? 0;
  const remaining = Math.max(0, goal.targetValue - actual);
  const pct = goal.targetValue ? Math.min(100, (actual / goal.targetValue) * 100) : 0;

  const saveActual = async () => {
    const value = draftActual.trim() === '' ? null : Number(draftActual.replace(',', '.'));
    await api(`/api/ops/goals/${goal.id}`, {
      method: 'PUT',
      body: JSON.stringify({ actualOverride: value }),
    });
    setEditingActual(false);
    onReload();
  };

  return (
    <div className="px-4 py-3 border-t border-gray-100 hover:bg-gray-50/50">
      <div className="flex items-center gap-3 text-sm">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-brand-dark truncate">{goal.metricLabel}</div>
          <div className="h-1.5 bg-gray-100 rounded-full mt-1.5 overflow-hidden">
            <div
              className="h-full bg-brand-accent rounded-full transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="text-right tabular-nums">
          {editingActual ? (
            <input
              autoFocus
              value={draftActual}
              onChange={(e) => setDraftActual(e.target.value)}
              onBlur={saveActual}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveActual();
                if (e.key === 'Escape') setEditingActual(false);
              }}
              className="w-24 text-sm text-right bg-yellow-50 border border-brand-accent/50 outline-none rounded px-2 py-0.5"
              placeholder="Utfall"
            />
          ) : (
            <button
              onClick={() => {
                setDraftActual(goal.actualOverride != null ? String(goal.actualOverride) : '');
                setEditingActual(true);
              }}
              className="text-sm text-gray-700 hover:text-brand-accent group"
              title="Klicka för att uppdatera utfall"
            >
              {goal.actualOverride != null ? (
                <span className="font-medium">{fmtNum(actual)}</span>
              ) : (
                <span className="text-gray-300 italic">utfall…</span>
              )}
              <span className="text-gray-400 ml-1">/ {fmtNum(goal.targetValue)}</span>{' '}
              <span className="text-xs text-gray-400">{goal.unit ?? ''}</span>
            </button>
          )}
          <div className="text-[10px] text-orange-600 mt-0.5">
            {goal.actualOverride != null ? `Kvar: ${fmtNum(remaining)} ${goal.unit ?? ''}` : ' '}
          </div>
        </div>
        <button
          onClick={async () => {
            if (!confirm(`Ta bort målet "${goal.metricLabel}"?`)) return;
            await api(`/api/ops/goals/${goal.id}`, { method: 'DELETE' });
            onReload();
          }}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────

function TasksBlock({
  section,
  title,
  groupByOwner = false,
}: {
  section: Section;
  title: string;
  groupByOwner?: boolean;
}) {
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDone, setShowDone] = useState(false);
  const [showStale, setShowStale] = useState(false);
  const [quickText, setQuickText] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<OpsTask[]>(`/api/ops/tasks?section=${section}`);
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    reload();
  }, [reload]);

  const parsed = useMemo(() => parseQuickAdd(quickText), [quickText]);

  const quickAdd = async () => {
    if (!parsed) return;
    setQuickAdding(true);
    try {
      await api(`/api/ops/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          section,
          title: parsed.title,
          owner: parsed.owner,
          deadline: parsed.deadline,
          status: 'OPEN',
        }),
      });
      setQuickText('');
      reload();
    } catch (e) {
      alert(`Fel: ${(e as Error).message}`);
    } finally {
      setQuickAdding(false);
    }
  };

  // Stale-filter: tasks vars deadline passerat med >30 dagar räknas som
  // gamla — dölj som default så veckouppföljningen inte fylls upp av
  // bortglömda uppdrag från månader sen. Odaterade tasks räknas inte som
  // gamla; de kan vara löpande.
  const isStale = (t: OpsTask): boolean => {
    if (!t.deadline) return false;
    const daysAgo = (Date.now() - new Date(t.deadline).getTime()) / 86_400_000;
    return daysAgo > 30;
  };
  const visible = tasks.filter((t) => {
    const done = t.status === 'DONE' || t.status === 'CANCELLED';
    if (done && !showDone) return false;
    if (!done && isStale(t) && !showStale) return false;
    return true;
  });
  const doneCount = tasks.filter((t) => t.status === 'DONE' || t.status === 'CANCELLED').length;
  const staleCount = tasks.filter(
    (t) => isStale(t) && t.status !== 'DONE' && t.status !== 'CANCELLED'
  ).length;

  const groups: Array<[string | null, OpsTask[]]> = useMemo(() => {
    if (!groupByOwner) return [[null, visible]];
    const m = new Map<string, OpsTask[]>();
    for (const t of visible) {
      const k = t.owner || 'Övriga';
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(t);
    }
    return Array.from(m.entries());
  }, [visible, groupByOwner]);

  return (
    <section className="space-y-2">
      <header className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-serif text-brand-dark">{title}</h2>
        {staleCount > 0 && (
          <button
            onClick={() => setShowStale((v) => !v)}
            className="text-xs text-amber-700 hover:text-amber-900"
            title="Tasks med deadline >30 dgr sen"
          >
            {showStale ? `Dölj gamla (${staleCount})` : `Visa gamla (${staleCount})`}
          </button>
        )}
        {doneCount > 0 && (
          <button
            onClick={() => setShowDone((v) => !v)}
            className="text-xs text-gray-400 hover:text-brand-dark"
          >
            {showDone ? `Dölj klara (${doneCount})` : `Visa klara (${doneCount})`}
          </button>
        )}
      </header>

      <div className="bg-white border border-gray-200 rounded-xl">
        {/* Quick-add — always visible at the top */}
        <div className="px-4 py-3 flex items-center gap-2 border-b border-gray-100">
          <Plus className="w-4 h-4 text-gray-400 flex-shrink-0" />
          <input
            value={quickText}
            onChange={(e) => setQuickText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                quickAdd();
              }
            }}
            placeholder='Ex: "Ringa Lista, Tenita, 31 maj" → Enter'
            disabled={quickAdding}
            className="flex-1 text-sm bg-transparent border-none outline-none text-brand-dark placeholder:text-gray-400"
          />
          {parsed && (parsed.owner || parsed.deadline) && (
            <span className="text-[11px] text-gray-500 whitespace-nowrap">
              {parsed.owner && <span className="mr-2">▸ {parsed.owner}</span>}
              {parsed.deadline && (
                <span>
                  ▸{' '}
                  {new Date(parsed.deadline).toLocaleDateString('sv-SE', {
                    day: 'numeric',
                    month: 'short',
                  })}
                </span>
              )}
            </span>
          )}
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm text-gray-400">Laddar…</div>
        ) : visible.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400 italic text-center">
            Inget att visa.
          </div>
        ) : (
          groups.map(([owner, list], i) => (
            <div key={owner ?? 'all'}>
              {groupByOwner && (
                <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 bg-gray-50/50 border-t border-gray-100">
                  {owner}
                </div>
              )}
              {list.map((t) => (
                <TaskRow key={t.id} task={t} onReload={reload} showOwner={!groupByOwner} />
              ))}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function TaskRow({
  task,
  onReload,
  showOwner,
}: {
  task: OpsTask;
  onReload: () => void;
  showOwner: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [editingOwner, setEditingOwner] = useState(false);
  const [draftOwner, setDraftOwner] = useState(task.owner ?? '');
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [draftDeadline, setDraftDeadline] = useState(task.deadline ? task.deadline.slice(0, 10) : '');
  // När man bockar av en task: visa "Klart!" en stund innan raden försvinner
  // ur listan (annars känns det som om man bara missade ett klick).
  const [justCompleted, setJustCompleted] = useState(false);

  const isDone = task.status === 'DONE' || task.status === 'CANCELLED';

  const patch = async (data: Record<string, unknown>) => {
    await api(`/api/ops/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(data) });
    onReload();
  };

  const toggleDone = async () => {
    const nextStatus = task.status === 'DONE' ? 'OPEN' : 'DONE';
    if (nextStatus === 'DONE') {
      setJustCompleted(true);
      await api(`/api/ops/tasks/${task.id}`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'DONE' }),
      });
      // Låt celebration synas ~700ms innan listan refetchar
      setTimeout(() => {
        setJustCompleted(false);
        onReload();
      }, 700);
    } else {
      patch({ status: 'OPEN' });
    }
  };

  const setStatus = (status: Status) => patch({ status });

  const saveTitle = () => {
    if (draftTitle.trim() && draftTitle !== task.title) {
      patch({ title: draftTitle.trim() });
    }
    setEditingTitle(false);
  };

  const saveOwner = () => {
    const value = draftOwner.trim();
    if (value !== (task.owner ?? '')) patch({ owner: value || null });
    setEditingOwner(false);
  };

  const saveDeadline = () => {
    const value = draftDeadline.trim() || null;
    const current = task.deadline ? task.deadline.slice(0, 10) : null;
    if (value !== current) patch({ deadline: value });
    setEditingDeadline(false);
  };

  const remove = async () => {
    if (!confirm(`Ta bort "${task.title}"?`)) return;
    await api(`/api/ops/tasks/${task.id}`, { method: 'DELETE' });
    onReload();
  };

  const hasDetails = task.nextStep || task.notes || task.relatedTo;

  return (
    <div
      className={`border-t border-gray-100 group transition-all duration-500 ${
        justCompleted
          ? 'bg-emerald-50 ring-1 ring-emerald-200'
          : isDone
            ? 'opacity-50'
            : ''
      }`}
    >
      <div className="px-4 py-2.5 flex items-center gap-3">
        <button
          onClick={toggleDone}
          className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
            task.status === 'DONE' || justCompleted
              ? 'bg-emerald-500 border-emerald-500 text-white scale-110'
              : 'border-gray-300 hover:border-brand-accent'
          }`}
        >
          {(task.status === 'DONE' || justCompleted) && <Check className="w-3 h-3" />}
        </button>
        {justCompleted && (
          <span className="text-xs font-bold text-emerald-700 uppercase tracking-wider animate-pulse">
            Klart!
          </span>
        )}

        {hasDetails && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-0.5 text-gray-400 hover:text-brand-dark"
          >
            {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
          </button>
        )}

        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input
              autoFocus
              value={draftTitle}
              onChange={(e) => setDraftTitle(e.target.value)}
              onBlur={saveTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') {
                  setDraftTitle(task.title);
                  setEditingTitle(false);
                }
              }}
              className="w-full text-sm bg-transparent border-b border-brand-accent outline-none py-0.5"
            />
          ) : (
            <button
              onClick={() => setEditingTitle(true)}
              className={`text-sm text-left ${isDone ? 'line-through' : ''} text-brand-dark hover:text-brand-accent`}
              title="Klicka för att redigera"
            >
              {task.title}
              {task.relatedTo && (
                <span className="ml-2 text-xs text-gray-400 font-normal">· {task.relatedTo}</span>
              )}
            </button>
          )}
        </div>

        {/* Owner — always editable (also when grouped, so user can re-assign) */}
        {editingOwner ? (
          <input
            autoFocus
            value={draftOwner}
            onChange={(e) => setDraftOwner(e.target.value)}
            onBlur={saveOwner}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveOwner();
              if (e.key === 'Escape') {
                setDraftOwner(task.owner ?? '');
                setEditingOwner(false);
              }
            }}
            placeholder="Ansvarig"
            className="w-24 text-xs bg-white border border-brand-accent rounded px-1.5 py-0.5 outline-none"
          />
        ) : task.owner ? (
          <button
            onClick={() => {
              setDraftOwner(task.owner ?? '');
              setEditingOwner(true);
            }}
            className="text-xs text-gray-600 px-2 py-0.5 bg-gray-100 rounded hover:bg-brand-accent/10 hover:text-brand-dark transition-colors"
            title="Klicka för att ändra ansvarig"
          >
            {task.owner}
          </button>
        ) : (
          <button
            onClick={() => {
              setDraftOwner('');
              setEditingOwner(true);
            }}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 hover:text-brand-dark px-1.5"
            title="Lägg till ansvarig"
          >
            + ansvarig
          </button>
        )}

        {/* Deadline */}
        {editingDeadline ? (
          <input
            autoFocus
            type="date"
            value={draftDeadline}
            onChange={(e) => setDraftDeadline(e.target.value)}
            onBlur={saveDeadline}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveDeadline();
              if (e.key === 'Escape') {
                setDraftDeadline(task.deadline ? task.deadline.slice(0, 10) : '');
                setEditingDeadline(false);
              }
            }}
            className="text-xs bg-white border border-brand-accent rounded px-1.5 py-0.5 outline-none"
          />
        ) : task.deadline ? (
          <button
            onClick={() => {
              setDraftDeadline(task.deadline ? task.deadline.slice(0, 10) : '');
              setEditingDeadline(true);
            }}
            className={`text-xs hover:text-brand-dark ${isOverdue(task.deadline, isDone) ? 'text-red-600' : 'text-gray-500'}`}
            title="Klicka för att ändra deadline"
          >
            {new Date(task.deadline).toLocaleDateString('sv-SE', {
              day: 'numeric',
              month: 'short',
            })}
          </button>
        ) : (
          <button
            onClick={() => {
              setDraftDeadline('');
              setEditingDeadline(true);
            }}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-gray-400 hover:text-brand-dark px-1.5"
            title="Lägg till deadline"
          >
            + deadline
          </button>
        )}
        {task.status !== 'OPEN' && task.status !== 'DONE' && (
          <StatusBadge status={task.status} />
        )}

        <select
          value={task.status}
          onChange={(e) => setStatus(e.target.value as Status)}
          className="opacity-0 group-hover:opacity-100 text-[10px] px-1 py-0.5 border border-gray-200 rounded bg-white text-gray-600"
          title="Status"
        >
          <option value="OPEN">Öppen</option>
          <option value="IN_PROGRESS">Pågår</option>
          <option value="WAITING">Väntar</option>
          <option value="DONE">Klar</option>
          <option value="CANCELLED">Avbruten</option>
        </select>
        <button
          onClick={remove}
          className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {expanded && hasDetails && (
        <div className="px-12 pb-3 -mt-1 text-xs text-gray-600 space-y-1">
          {task.nextStep && (
            <div>
              <span className="text-gray-400">Nästa steg: </span>
              {task.nextStep}
            </div>
          )}
          {task.notes && (
            <div>
              <span className="text-gray-400">Anteckningar: </span>
              {task.notes}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    OPEN: { label: 'Öppen', cls: 'bg-gray-100 text-gray-700' },
    IN_PROGRESS: { label: 'Pågår', cls: 'bg-blue-100 text-blue-800' },
    WAITING: { label: 'Väntar', cls: 'bg-amber-100 text-amber-800' },
    DONE: { label: 'Klar', cls: 'bg-emerald-100 text-emerald-800' },
    CANCELLED: { label: 'Avbruten', cls: 'bg-gray-100 text-gray-400' },
  };
  const v = map[status];
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${v.cls}`}>{v.label}</span>;
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function parseQuickAdd(raw: string) {
  const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const title = parts[0];
  let owner: string | null = null;
  let deadline: string | null = null;
  for (const p of parts.slice(1)) {
    const date = tryParseSwedishDate(p);
    if (date && !deadline) deadline = date;
    else if (!owner) owner = p;
  }
  return { title, owner, deadline };
}

/**
 * Parse strings like "31 maj", "31 maj 2026", "31/5", "31/5/2026",
 * "2026-05-31", "imorgon", "idag", "måndag" into YYYY-MM-DD.
 */
function tryParseSwedishDate(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;

  // ISO
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [y, m, d] = t.split('-').map(Number);
    return iso(new Date(y, m - 1, d));
  }

  // d/m or d/m/yy(yy)
  const sl = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (sl) {
    const d = +sl[1];
    const m = +sl[2] - 1;
    let y = sl[3] ? +sl[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    return iso(new Date(y, m, d));
  }

  // "31 maj" / "31 maj 2026"
  const months: Record<string, number> = {
    jan: 0, januari: 0, feb: 1, februari: 1, mar: 2, mars: 2,
    apr: 3, april: 3, maj: 4, jun: 5, juni: 5, jul: 6, juli: 6,
    aug: 7, augusti: 7, sep: 8, sept: 8, september: 8, okt: 9,
    oktober: 9, nov: 10, november: 10, dec: 11, december: 11,
  };
  const sw = t.match(/^(\d{1,2})\s+([a-zåäö]+)\s*(\d{4})?$/);
  if (sw) {
    const d = +sw[1];
    const mKey = sw[2];
    if (mKey in months) {
      const m = months[mKey];
      const y = sw[3] ? +sw[3] : (() => {
        const now = new Date();
        const candidate = new Date(now.getFullYear(), m, d);
        return candidate < now ? now.getFullYear() + 1 : now.getFullYear();
      })();
      return iso(new Date(y, m, d));
    }
  }

  // Relative
  const now = new Date();
  if (t === 'idag' || t === 'today') return iso(now);
  if (t === 'imorgon' || t === 'i morgon' || t === 'tomorrow') {
    const x = new Date(now);
    x.setDate(x.getDate() + 1);
    return iso(x);
  }
  if (t === 'iövermorgon' || t === 'i övermorgon') {
    const x = new Date(now);
    x.setDate(x.getDate() + 2);
    return iso(x);
  }

  // Weekday name → next occurrence
  const weekdays: Record<string, number> = {
    söndag: 0, mån: 1, måndag: 1, tis: 2, tisdag: 2, ons: 3, onsdag: 3,
    tor: 4, torsdag: 4, fre: 5, fredag: 5, lör: 6, lördag: 6, sön: 0,
  };
  if (t in weekdays) {
    const target = weekdays[t];
    const x = new Date(now);
    const diff = (target - x.getDay() + 7) % 7 || 7;
    x.setDate(x.getDate() + diff);
    return iso(x);
  }

  return null;
}

function iso(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtNum(v: number): string {
  return new Intl.NumberFormat('sv-SE').format(Math.round(v));
}

function isoWeek(d: Date): number {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() + 3 - ((x.getDay() + 6) % 7));
  const w1 = new Date(x.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(((x.getTime() - w1.getTime()) / 86400000 - 3 + ((w1.getDay() + 6) % 7)) / 7)
  );
}

function startOfISOWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - dow);
  return x;
}

function isOverdue(dateStr: string, done: boolean): boolean {
  if (done) return false;
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}
