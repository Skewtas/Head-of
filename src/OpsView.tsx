/**
 * VECKOUPPFÖLJNING — Uppgifter + Mål.
 *
 * Struktur:
 *  - <GoalsBlock/>  → hämtar mål från /api/ops/overview-goals (samma källa
 *    som Översikten). Ingen dubbelinmatning.
 *  - <TasksBlock/>  → uppgifter (ACTION-sektionen). Filter-chips: Öppna,
 *    Försenade, Denna vecka, Utan ansvarig, Klara.
 *
 * Pipeline och Personliga tasks TOGS BORT från UI (2026-09-01) och arkiverades
 * i databasen (ops_tasks.archived_at). Datan finns kvar för historik men
 * visas inte i UI:et längre.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  Target,
  Trash2,
  AlertTriangle,
  Clock,
  UserMinus,
} from 'lucide-react';
import { api } from './lib/api';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

type Status = 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'DONE' | 'CANCELLED';

interface OpsTask {
  id: number;
  section: 'ACTION' | 'PIPELINE' | 'PERSONAL'; // schema-enum finns kvar; UI visar bara ACTION
  owner: string | null;
  title: string;
  nextStep: string | null;
  relatedTo: string | null;
  status: Status;
  deadline: string | null;
  notes: string | null;
  completedAt: string | null;
  completedBy: string | null;
}

interface OverviewGoal {
  key: string;
  label: string;
  actual: number;
  target: number;
  unit: string;
  progress: number;               // 0..∞ (kan vara >100 om över mål)
  status: 'over' | 'ok' | 'behind';
  goalId: number | null;
}
interface OverviewGoalsResp {
  monthLabel: string;
  periodStart: string;
  periodEnd: string;
  goals: OverviewGoal[];
  source: string;
  statsCached: boolean | null;
  statsStale: boolean | null;
  statsAgeMinutes: number | null;
}

type TaskFilter = 'OPEN_AND_LATE' | 'OVERDUE' | 'THIS_WEEK' | 'UNASSIGNED' | 'DONE' | 'ALL';

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

export default function OpsView() {
  return (
    <div className="space-y-8">
      <GoalsBlock />
      <TasksBlock />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// GOALS — läser Översiktens KPI:er (en källa)
// ─────────────────────────────────────────────────────────────────────────

function GoalsBlock() {
  const [data, setData] = useState<OverviewGoalsResp | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<OverviewGoalsResp>('/api/ops/overview-goals');
      setData(r);
    } catch (e) {
      console.error('overview-goals failed', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <Target className="w-4 h-4 text-brand-accent" />
        <h2 className="text-lg font-serif text-brand-dark">Mål</h2>
        {data && (
          <span className="text-xs text-gray-400">
            · {data.monthLabel}
            {data.statsAgeMinutes != null && (
              <span className="ml-2 text-[10px] italic text-gray-400/80">
                Data {data.statsAgeMinutes} min gammal från Översikten
              </span>
            )}
          </span>
        )}
      </header>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-600 flex items-center gap-2">
          <CalendarIcon className="w-3 h-3" />
          Månadsmål — synkat mot Översikten
        </div>
        {loading ? (
          <div className="px-4 py-6 text-sm text-gray-400">Laddar…</div>
        ) : !data || data.goals.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400 italic text-center">
            Inga mål tillgängliga just nu.
          </div>
        ) : (
          data.goals.map((g) => <OverviewGoalRow key={g.key} goal={g} />)
        )}
      </div>
    </section>
  );
}

function OverviewGoalRow({ goal }: { goal: OverviewGoal }) {
  const pctCapped = Math.min(100, goal.progress);
  const barCls =
    goal.status === 'over'
      ? 'bg-emerald-500'
      : goal.status === 'ok'
        ? 'bg-amber-400'
        : 'bg-red-400';
  const valueCls =
    goal.status === 'over' ? 'text-emerald-700 font-semibold' : 'text-gray-700';

  return (
    <div className="px-4 py-3 border-t border-gray-100">
      <div className="flex items-center gap-3 text-sm">
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1.5">
            <div className="font-medium text-brand-dark truncate">{goal.label}</div>
            <div className={`text-xs tabular-nums ${valueCls}`}>
              {fmtNum(goal.actual)} / {fmtNum(goal.target)} {goal.unit}
              <span className="text-gray-400 ml-2">({goal.progress}%)</span>
            </div>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${barCls} rounded-full transition-all`}
              style={{ width: `${pctCapped}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// TASKS
// ─────────────────────────────────────────────────────────────────────────

function TasksBlock() {
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<TaskFilter>('OPEN_AND_LATE');
  const [quickText, setQuickText] = useState('');
  const [quickAdding, setQuickAdding] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Hämtar ALLA sektioner (ACTION + återställda PIPELINE/PERSONAL).
      // Vi filtrerar inte längre på section i UI:et — allt bor i samma lista.
      const data = await api<OpsTask[]>(`/api/ops/tasks`);
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  const parsed = useMemo(() => parseQuickAdd(quickText), [quickText]);

  const quickAdd = async () => {
    if (!parsed) return;
    setQuickAdding(true);
    try {
      await api(`/api/ops/tasks`, {
        method: 'POST',
        body: JSON.stringify({
          section: 'ACTION',
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

  // Räkningar för filter-chips
  const counts = useMemo(() => {
    const c = { overdue: 0, thisWeek: 0, unassigned: 0, done: 0, open: 0, all: tasks.length };
    for (const t of tasks) {
      const done = t.status === 'DONE' || t.status === 'CANCELLED';
      if (done) { c.done++; continue; }
      c.open++;
      if (t.deadline && isOverdue(t.deadline, false)) c.overdue++;
      if (t.deadline && isThisWeek(t.deadline)) c.thisWeek++;
      if (!t.owner) c.unassigned++;
    }
    return c;
  }, [tasks]);

  // Filtrera enligt vald chip
  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      const done = t.status === 'DONE' || t.status === 'CANCELLED';
      switch (filter) {
        case 'OPEN_AND_LATE': return !done; // öppna + försenade (allt utom klara/avbrutna)
        case 'OVERDUE':       return !done && t.deadline && isOverdue(t.deadline, false);
        case 'THIS_WEEK':     return !done && t.deadline && isThisWeek(t.deadline);
        case 'UNASSIGNED':    return !done && !t.owner;
        case 'DONE':          return done;
        case 'ALL':           return true;
      }
    });
  }, [tasks, filter]);

  // Sortering: försenade högst upp, sedan denna vecka, sedan öppna med senare deadline,
  // sedan utan deadline, sist klara.
  const sorted = useMemo(() => {
    const rank = (t: OpsTask): number => {
      const done = t.status === 'DONE' || t.status === 'CANCELLED';
      if (done) return 90;
      if (t.deadline && isOverdue(t.deadline, false)) return 10; // försenad
      if (t.deadline && isThisWeek(t.deadline)) return 20;       // denna vecka
      if (t.deadline) return 30;                                  // framtida deadline
      return 40;                                                  // ingen deadline
    };
    return [...filtered].sort((a, b) => {
      const ra = rank(a), rb = rank(b);
      if (ra !== rb) return ra - rb;
      // Sekundär: tidigast deadline först
      if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });
  }, [filtered]);

  const filterButtons: Array<{ key: TaskFilter; label: string; count: number; icon: any; tone: string }> = [
    { key: 'OPEN_AND_LATE', label: 'Öppna', count: counts.open, icon: null, tone: 'default' },
    { key: 'OVERDUE',       label: 'Försenade', count: counts.overdue, icon: AlertTriangle, tone: 'red' },
    { key: 'THIS_WEEK',     label: 'Denna vecka', count: counts.thisWeek, icon: Clock, tone: 'amber' },
    { key: 'UNASSIGNED',    label: 'Utan ansvarig', count: counts.unassigned, icon: UserMinus, tone: 'gray' },
    { key: 'DONE',          label: 'Klara', count: counts.done, icon: Check, tone: 'emerald' },
    { key: 'ALL',           label: 'Alla', count: counts.all, icon: null, tone: 'default' },
  ];

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-3 flex-wrap">
        <h2 className="text-lg font-serif text-brand-dark">Actionlista</h2>
      </header>

      {/* Filter-chips */}
      <div className="flex items-center gap-2 flex-wrap text-xs">
        {filterButtons.map((f) => {
          const isActive = filter === f.key;
          const Icon = f.icon;
          const toneCls = isActive
            ? 'bg-brand-dark text-white border-brand-dark'
            : f.tone === 'red' && f.count > 0
              ? 'bg-white border-red-200 text-red-700 hover:bg-red-50'
              : f.tone === 'amber' && f.count > 0
                ? 'bg-white border-amber-200 text-amber-800 hover:bg-amber-50'
                : f.tone === 'gray' && f.count > 0
                  ? 'bg-white border-gray-300 text-gray-700 hover:bg-gray-50'
                  : f.tone === 'emerald' && f.count > 0
                    ? 'bg-white border-emerald-200 text-emerald-800 hover:bg-emerald-50'
                    : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50';
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 border rounded-full ${toneCls}`}
            >
              {Icon && <Icon className="w-3 h-3" />}
              {f.label}
              <span className={`text-[10px] ${isActive ? 'text-white/80' : 'text-gray-400'}`}>{f.count}</span>
            </button>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        {/* Quick-add */}
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
                  ▸ {new Date(parsed.deadline).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}
                </span>
              )}
            </span>
          )}
        </div>

        {loading ? (
          <div className="px-4 py-6 text-sm text-gray-400">Laddar…</div>
        ) : sorted.length === 0 ? (
          <div className="px-4 py-6 text-sm text-gray-400 italic text-center">
            {filter === 'OPEN_AND_LATE'
              ? 'Inga öppna uppgifter — bra jobbat!'
              : filter === 'OVERDUE'
                ? 'Inga försenade uppgifter.'
                : filter === 'THIS_WEEK'
                  ? 'Inga uppgifter med deadline denna vecka.'
                  : filter === 'UNASSIGNED'
                    ? 'Alla uppgifter har en ansvarig.'
                    : filter === 'DONE'
                      ? 'Inga klara uppgifter ännu.'
                      : 'Inget att visa.'}
          </div>
        ) : (
          sorted.map((t) => <TaskRow key={t.id} task={t} onReload={reload} />)
        )}
      </div>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// TaskRow — kompakt struktur: [✓] Titel · Ansvarig · Deadline · Status
// ─────────────────────────────────────────────────────────────────────────

function TaskRow({ task, onReload }: { task: OpsTask; onReload: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [editingOwner, setEditingOwner] = useState(false);
  const [draftOwner, setDraftOwner] = useState(task.owner ?? '');
  const [editingDeadline, setEditingDeadline] = useState(false);
  const [draftDeadline, setDraftDeadline] = useState(task.deadline ? task.deadline.slice(0, 10) : '');
  const [justCompleted, setJustCompleted] = useState(false);

  const isDone = task.status === 'DONE' || task.status === 'CANCELLED';
  const overdue = task.deadline ? isOverdue(task.deadline, isDone) : false;

  const patch = async (data: Record<string, unknown>) => {
    await api(`/api/ops/tasks/${task.id}`, { method: 'PUT', body: JSON.stringify(data) });
    onReload();
  };

  // Snabb-bocka-av — atomisk toggle på backend som sparar completedAt + completedBy
  const toggleDone = async () => {
    if (task.status !== 'DONE') setJustCompleted(true);
    try {
      await api(`/api/ops/tasks/${task.id}/toggle-complete`, { method: 'POST' });
      // Låt celebration synas ~600 ms
      setTimeout(() => {
        setJustCompleted(false);
        onReload();
      }, task.status === 'DONE' ? 0 : 600);
    } catch (e) {
      setJustCompleted(false);
      alert('Kunde inte uppdatera status: ' + (e as Error).message);
    }
  };

  const setStatus = (status: Status) => patch({ status });

  const saveTitle = () => {
    if (draftTitle.trim() && draftTitle !== task.title) patch({ title: draftTitle.trim() });
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
            ? 'opacity-60'
            : overdue
              ? 'bg-red-50/40'
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
          title={task.status === 'DONE' ? 'Ångra klar-markering' : 'Bocka av som klar'}
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
                if (e.key === 'Escape') { setDraftTitle(task.title); setEditingTitle(false); }
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
          {/* Metadata under titeln när klart — visar VEM + NÄR */}
          {isDone && task.completedAt && (
            <div className="text-[10px] text-emerald-700/70 mt-0.5">
              ✓ Klar {new Date(task.completedAt).toLocaleDateString('sv-SE', {
                day: 'numeric', month: 'short',
              })} kl. {new Date(task.completedAt).toLocaleTimeString('sv-SE', {
                hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Stockholm',
              })}
              {task.completedBy && <span> · av {task.completedBy}</span>}
            </div>
          )}
        </div>

        {/* Ansvarig */}
        {editingOwner ? (
          <input
            autoFocus
            value={draftOwner}
            onChange={(e) => setDraftOwner(e.target.value)}
            onBlur={saveOwner}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveOwner();
              if (e.key === 'Escape') { setDraftOwner(task.owner ?? ''); setEditingOwner(false); }
            }}
            placeholder="Ansvarig"
            className="w-24 text-xs bg-white border border-brand-accent rounded px-1.5 py-0.5 outline-none"
          />
        ) : task.owner ? (
          <button
            onClick={() => { setDraftOwner(task.owner ?? ''); setEditingOwner(true); }}
            className="text-xs text-gray-600 px-2 py-0.5 bg-gray-100 rounded hover:bg-brand-accent/10 hover:text-brand-dark transition-colors"
            title="Klicka för att ändra ansvarig"
          >
            {task.owner}
          </button>
        ) : (
          <button
            onClick={() => { setDraftOwner(''); setEditingOwner(true); }}
            className="text-[10px] text-gray-400 hover:text-brand-dark px-1.5 border border-dashed border-gray-300 rounded"
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
              if (e.key === 'Escape') { setDraftDeadline(task.deadline ? task.deadline.slice(0, 10) : ''); setEditingDeadline(false); }
            }}
            className="text-xs bg-white border border-brand-accent rounded px-1.5 py-0.5 outline-none"
          />
        ) : task.deadline ? (
          <button
            onClick={() => { setDraftDeadline(task.deadline ? task.deadline.slice(0, 10) : ''); setEditingDeadline(true); }}
            className={`text-xs px-1.5 py-0.5 rounded ${
              overdue
                ? 'bg-red-100 text-red-800 font-semibold'
                : task.deadline && isThisWeek(task.deadline)
                  ? 'bg-amber-50 text-amber-800'
                  : 'text-gray-500 hover:text-brand-dark'
            }`}
            title={overdue ? 'Försenad — klicka för att ändra deadline' : 'Klicka för att ändra deadline'}
          >
            {overdue && '⚠ '}
            {new Date(task.deadline).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}
          </button>
        ) : (
          <button
            onClick={() => { setDraftDeadline(''); setEditingDeadline(true); }}
            className="text-[10px] text-gray-400 hover:text-brand-dark px-1.5 border border-dashed border-gray-300 rounded"
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
          <option value="OPEN">Ej påbörjad</option>
          <option value="IN_PROGRESS">Pågående</option>
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
            <div><span className="text-gray-400">Nästa steg: </span>{task.nextStep}</div>
          )}
          {task.notes && (
            <div><span className="text-gray-400">Anteckningar: </span>{task.notes}</div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  const map: Record<Status, { label: string; cls: string }> = {
    OPEN:        { label: 'Ej påbörjad', cls: 'bg-gray-100 text-gray-700' },
    IN_PROGRESS: { label: 'Pågående',    cls: 'bg-blue-100 text-blue-800' },
    WAITING:     { label: 'Väntar',       cls: 'bg-amber-100 text-amber-800' },
    DONE:        { label: 'Klar',         cls: 'bg-emerald-100 text-emerald-800' },
    CANCELLED:   { label: 'Avbruten',     cls: 'bg-gray-100 text-gray-400' },
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

  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [y, m, d] = t.split('-').map(Number);
    return iso(new Date(y, m - 1, d));
  }

  const sl = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (sl) {
    const d = +sl[1];
    const m = +sl[2] - 1;
    let y = sl[3] ? +sl[3] : new Date().getFullYear();
    if (y < 100) y += 2000;
    return iso(new Date(y, m, d));
  }

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

  const now = new Date();
  if (t === 'idag' || t === 'today') return iso(now);
  if (t === 'imorgon' || t === 'i morgon' || t === 'tomorrow') {
    const x = new Date(now); x.setDate(x.getDate() + 1); return iso(x);
  }
  if (t === 'iövermorgon' || t === 'i övermorgon') {
    const x = new Date(now); x.setDate(x.getDate() + 2); return iso(x);
  }

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

/** Startdatum av innevarande ISO-vecka (måndag). */
function startOfISOWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const dow = (x.getDay() + 6) % 7; // 0 = måndag
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

/** Är deadline mellan idag (inklusive) och söndag i innevarande vecka? */
function isThisWeek(dateStr: string): boolean {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekStart = startOfISOWeek(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  return d >= today && d <= weekEnd;
}
