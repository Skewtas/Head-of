import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Pencil,
  Plus,
  RotateCw,
  Target,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from './lib/api';

// ─────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────

interface OpsGoal {
  id: number;
  periodType: 'YEAR' | 'MONTH' | 'WEEK';
  periodStart: string;
  periodEnd: string;
  metricKey: string;
  metricLabel: string;
  targetValue: number;
  actualOverride: number | null;
  unit: string | null;
  notes: string | null;
  sortOrder: number;
}

interface OpsTask {
  id: number;
  section: 'PIPELINE' | 'ACTION' | 'PERSONAL';
  owner: string | null;
  title: string;
  nextStep: string | null;
  relatedTo: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'WAITING' | 'DONE' | 'CANCELLED';
  deadline: string | null;
  notes: string | null;
  sortOrder: number;
}

// ─────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────

export default function OpsView() {
  const [tab, setTab] = useState<'goals' | 'pipeline' | 'actions' | 'personal'>('goals');

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-100 -mx-8 px-8">
        {[
          { key: 'goals', label: 'Mål', icon: Target },
          { key: 'pipeline', label: 'Pipeline', icon: Users },
          { key: 'actions', label: 'Actionlista', icon: AlertTriangle },
          { key: 'personal', label: 'Personliga tasks', icon: CheckCircle2 },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key as any)}
            className={`inline-flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition ${
              tab === t.key
                ? 'border-brand-accent text-brand-accent'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            <t.icon className="w-3.5 h-3.5" />
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'goals' && <GoalsPanel />}
      {tab === 'pipeline' && <TasksPanel section="PIPELINE" title="Kunder & anställda i pipen" />}
      {tab === 'actions' && <TasksPanel section="ACTION" title="Actionlista" />}
      {tab === 'personal' && <TasksPanel section="PERSONAL" title="Personliga tasks" />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Goals
// ─────────────────────────────────────────────────────────────────────────

function GoalsPanel() {
  const [goals, setGoals] = useState<OpsGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<'YEAR' | 'MONTH' | 'WEEK'>('MONTH');
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ periodType: period });
      const data = await api<OpsGoal[]>(`/api/ops/goals?${q}`);
      setGoals(data);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    reload();
  }, [reload]);

  const seed = async () => {
    if (
      !confirm(
        'Importera årsmål och månadsmål från Excel-arket? (Befintliga rader bevaras.)'
      )
    )
      return;
    const r = await api<{ created: number; skipped: number }>(`/api/ops/seed`, {
      method: 'POST',
    });
    alert(`Skapade ${r.created} mål, hoppade över ${r.skipped} som redan fanns.`);
    reload();
  };

  // Group by periodStart
  const grouped = useMemo(() => {
    const m = new Map<string, OpsGoal[]>();
    for (const g of goals) {
      const k = g.periodStart.slice(0, 10);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(g);
    }
    return Array.from(m.entries()).sort(([a], [b]) => (a < b ? 1 : -1));
  }, [goals]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
          {(['YEAR', 'MONTH', 'WEEK'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-md ${
                period === p ? 'bg-white shadow text-brand-dark' : 'text-gray-500'
              }`}
            >
              {p === 'YEAR' ? 'År' : p === 'MONTH' ? 'Månad' : 'Vecka'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand-accent text-white rounded-lg text-xs font-medium"
        >
          <Plus className="w-3 h-3" /> Nytt mål
        </button>
        <button
          onClick={seed}
          className="ml-auto flex items-center gap-1 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg text-xs font-medium"
        >
          <RotateCw className="w-3 h-3" /> Importera Excel-mål
        </button>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Laddar...</div>
      ) : grouped.length === 0 ? (
        <div className="p-6 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
          Inga mål för {period === 'YEAR' ? 'året' : period === 'MONTH' ? 'månaden' : 'veckan'}.
          Klicka <em>Importera Excel-mål</em> för att fylla på från Mikaelas ark.
        </div>
      ) : (
        grouped.map(([periodStart, items]) => (
          <div
            key={periodStart}
            className="bg-white border border-gray-200 rounded-xl overflow-hidden"
          >
            <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-medium text-gray-600 flex items-center gap-2">
              <CalendarIcon className="w-3 h-3" />
              {formatPeriodLabel(periodStart, items[0].periodEnd, period)}
            </div>
            <table className="w-full text-sm">
              <thead className="text-[10px] text-gray-400 uppercase tracking-wider">
                <tr>
                  <th className="text-left px-4 py-2">Mål</th>
                  <th className="text-right px-4 py-2">Mål-värde</th>
                  <th className="text-right px-4 py-2">Utfall</th>
                  <th className="text-right px-4 py-2">Kvar</th>
                  <th className="w-24"></th>
                </tr>
              </thead>
              <tbody>
                {items
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((g) => {
                    const actual = g.actualOverride ?? 0;
                    const remaining = g.targetValue - actual;
                    const pct = g.targetValue
                      ? Math.min(100, Math.max(0, (actual / g.targetValue) * 100))
                      : 0;
                    return (
                      <tr key={g.id} className="border-t border-gray-100">
                        <td className="px-4 py-3">
                          <div className="font-medium text-gray-900">
                            {g.metricLabel}
                          </div>
                          <div className="w-full h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
                            <div
                              className="h-full bg-brand-accent rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatValue(g.targetValue, g.unit)}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          {g.actualOverride == null ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            formatValue(actual, g.unit)
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-orange-600 font-medium">
                          {g.actualOverride == null ? (
                            <span className="text-gray-300">—</span>
                          ) : (
                            formatValue(Math.max(0, remaining), g.unit)
                          )}
                        </td>
                        <td className="px-2 py-3 text-right">
                          <button
                            onClick={() => setEditingId(g.id)}
                            className="p-1 text-gray-400 hover:text-brand-dark"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={async () => {
                              if (!confirm(`Ta bort målet "${g.metricLabel}"?`)) return;
                              await api(`/api/ops/goals/${g.id}`, { method: 'DELETE' });
                              reload();
                            }}
                            className="p-1 text-gray-400 hover:text-red-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </div>
        ))
      )}

      {(adding || editingId !== null) && (
        <GoalEditor
          defaultPeriodType={period}
          goal={editingId != null ? goals.find((g) => g.id === editingId) ?? null : null}
          onClose={() => {
            setAdding(false);
            setEditingId(null);
          }}
          onSaved={() => {
            setAdding(false);
            setEditingId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function GoalEditor({
  goal,
  defaultPeriodType,
  onClose,
  onSaved,
}: {
  goal: OpsGoal | null;
  defaultPeriodType: 'YEAR' | 'MONTH' | 'WEEK';
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!goal;
  const [periodType, setPeriodType] = useState<'YEAR' | 'MONTH' | 'WEEK'>(
    goal?.periodType ?? defaultPeriodType
  );
  const [periodStart, setPeriodStart] = useState<string>(
    goal ? goal.periodStart.slice(0, 10) : new Date().toISOString().slice(0, 10)
  );
  const [periodEnd, setPeriodEnd] = useState<string>(
    goal
      ? goal.periodEnd.slice(0, 10)
      : new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).toISOString().slice(0, 10)
  );
  const [metricLabel, setMetricLabel] = useState(goal?.metricLabel ?? '');
  const [metricKey, setMetricKey] = useState(goal?.metricKey ?? 'custom');
  const [targetValue, setTargetValue] = useState<string>(String(goal?.targetValue ?? ''));
  const [actualOverride, setActualOverride] = useState<string>(
    goal?.actualOverride != null ? String(goal.actualOverride) : ''
  );
  const [unit, setUnit] = useState(goal?.unit ?? 'kr');
  const [notes, setNotes] = useState(goal?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        periodType,
        periodStart,
        periodEnd,
        metricLabel,
        metricKey,
        targetValue: Number(targetValue.replace(',', '.')) || 0,
        actualOverride: actualOverride.trim() === '' ? null : Number(actualOverride.replace(',', '.')),
        unit,
        notes: notes || null,
      };
      if (isEdit) {
        await api(`/api/ops/goals/${goal!.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api(`/api/ops/goals`, { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) {
      alert(`Fel: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-3 max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-serif text-lg">{isEdit ? 'Redigera mål' : 'Nytt mål'}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['YEAR', 'MONTH', 'WEEK'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriodType(p)}
              className={`py-1.5 rounded-lg text-xs ${
                periodType === p ? 'bg-brand-accent text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {p === 'YEAR' ? 'År' : p === 'MONTH' ? 'Månad' : 'Vecka'}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-gray-500">
            Från
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
            />
          </label>
          <label className="text-xs text-gray-500">
            Till
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className="w-full mt-1 px-2 py-1.5 border border-gray-200 rounded-lg text-sm"
            />
          </label>
        </div>
        <input
          value={metricLabel}
          onChange={(e) => setMetricLabel(e.target.value)}
          placeholder='Etikett, t.ex. "Fakturerad försäljning"'
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={targetValue}
            onChange={(e) => setTargetValue(e.target.value)}
            placeholder="Mål-värde"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={actualOverride}
            onChange={(e) => setActualOverride(e.target.value)}
            placeholder="Utfall (valfritt)"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {['kr', 'st', '%'].map((u) => (
            <button
              key={u}
              onClick={() => setUnit(u)}
              className={`py-1.5 rounded-lg text-xs ${
                unit === u ? 'bg-brand-accent text-white' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {u}
            </button>
          ))}
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anteckningar"
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600">
            Avbryt
          </button>
          <button
            onClick={save}
            disabled={saving || !metricLabel}
            className="px-3 py-1.5 bg-brand-accent text-white rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? 'Sparar...' : 'Spara'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tasks (Pipeline / Action / Personal)
// ─────────────────────────────────────────────────────────────────────────

function TasksPanel({
  section,
  title,
}: {
  section: 'PIPELINE' | 'ACTION' | 'PERSONAL';
  title: string;
}) {
  const [tasks, setTasks] = useState<OpsTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('open'); // open | all
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams({ section });
      const data = await api<OpsTask[]>(`/api/ops/tasks?${q}`);
      setTasks(data);
    } finally {
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    reload();
  }, [reload]);

  const setStatus = async (id: number, status: OpsTask['status']) => {
    await api(`/api/ops/tasks/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
    reload();
  };

  // Group by owner for PERSONAL, by status for others
  const groups = useMemo(() => {
    const visible = tasks.filter((t) =>
      filterStatus === 'all'
        ? true
        : t.status !== 'DONE' && t.status !== 'CANCELLED'
    );
    if (section === 'PERSONAL') {
      const m = new Map<string, OpsTask[]>();
      for (const t of visible) {
        const k = t.owner || 'Övriga';
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push(t);
      }
      return Array.from(m.entries());
    }
    return [['Alla', visible] as [string, OpsTask[]]];
  }, [tasks, section, filterStatus]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h3 className="text-sm font-medium text-gray-700">{title}</h3>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1 px-3 py-1.5 bg-brand-accent text-white rounded-lg text-xs font-medium"
        >
          <Plus className="w-3 h-3" /> Lägg till
        </button>
        <div className="ml-auto flex bg-gray-100 rounded-lg p-0.5 text-xs">
          {[
            { value: 'open', label: 'Aktiva' },
            { value: 'all', label: 'Alla' },
          ].map((f) => (
            <button
              key={f.value}
              onClick={() => setFilterStatus(f.value)}
              className={`px-3 py-1 rounded-md ${
                filterStatus === f.value ? 'bg-white shadow text-brand-dark' : 'text-gray-500'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="text-sm text-gray-400">Laddar...</div>
      ) : groups.length === 0 || groups.every(([, list]) => list.length === 0) ? (
        <div className="p-6 bg-gray-50 rounded-xl text-sm text-gray-500 text-center">
          Inga {title.toLowerCase()} än. Klicka <em>Lägg till</em>.
        </div>
      ) : (
        groups.map(([owner, list]) => (
          <div key={owner} className="space-y-2">
            {section === 'PERSONAL' && (
              <h4 className="text-xs font-semibold uppercase tracking-wider text-brand-muted">
                {owner}
              </h4>
            )}
            {list.length === 0 ? (
              <p className="text-sm text-gray-400">Inga.</p>
            ) : (
              <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
                {list.map((t, i) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    showOwner={section !== 'PERSONAL'}
                    onStatus={(s) => setStatus(t.id, s)}
                    onEdit={() => setEditingId(t.id)}
                    onDelete={async () => {
                      if (!confirm(`Ta bort "${t.title}"?`)) return;
                      await api(`/api/ops/tasks/${t.id}`, { method: 'DELETE' });
                      reload();
                    }}
                    isLast={i === list.length - 1}
                  />
                ))}
              </div>
            )}
          </div>
        ))
      )}

      {(showAdd || editingId !== null) && (
        <TaskEditor
          section={section}
          task={editingId != null ? tasks.find((t) => t.id === editingId) ?? null : null}
          onClose={() => {
            setShowAdd(false);
            setEditingId(null);
          }}
          onSaved={() => {
            setShowAdd(false);
            setEditingId(null);
            reload();
          }}
        />
      )}
    </div>
  );
}

function TaskRow({
  task,
  showOwner,
  onStatus,
  onEdit,
  onDelete,
  isLast,
}: {
  task: OpsTask;
  showOwner: boolean;
  onStatus: (s: OpsTask['status']) => void;
  onEdit: () => void;
  onDelete: () => void;
  isLast: boolean;
}) {
  const done = task.status === 'DONE' || task.status === 'CANCELLED';
  return (
    <div className={`p-4 ${!isLast ? 'border-b border-gray-100' : ''} ${done ? 'opacity-60' : ''}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={() => onStatus(task.status === 'DONE' ? 'OPEN' : 'DONE')}
          className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${
            task.status === 'DONE'
              ? 'bg-emerald-500 border-emerald-500 text-white'
              : 'border-gray-300 hover:border-gray-500'
          }`}
        >
          {task.status === 'DONE' && <CheckCircle2 className="w-3 h-3" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-medium ${done ? 'line-through text-gray-500' : 'text-gray-900'}`}>
            {task.title}
            {task.relatedTo && (
              <span className="ml-2 text-xs text-gray-400 font-normal">· {task.relatedTo}</span>
            )}
          </div>
          {task.nextStep && (
            <p className="text-xs text-gray-600 mt-1 whitespace-pre-wrap">{task.nextStep}</p>
          )}
          {task.notes && (
            <p className="text-xs text-gray-400 mt-1 whitespace-pre-wrap">{task.notes}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-[11px]">
            {showOwner && task.owner && (
              <span className="px-2 py-0.5 bg-gray-100 rounded text-gray-700">{task.owner}</span>
            )}
            <StatusBadge status={task.status} />
            {task.deadline && (
              <span className="text-gray-500 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                {new Date(task.deadline).toLocaleDateString('sv-SE', {
                  day: 'numeric',
                  month: 'short',
                })}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-start gap-0.5">
          <select
            value={task.status}
            onChange={(e) => onStatus(e.target.value as OpsTask['status'])}
            className="text-[11px] px-1.5 py-1 border border-gray-200 rounded bg-white"
          >
            <option value="OPEN">Öppen</option>
            <option value="IN_PROGRESS">Pågår</option>
            <option value="WAITING">Väntar</option>
            <option value="DONE">Klar</option>
            <option value="CANCELLED">Avbruten</option>
          </select>
          <button
            onClick={onEdit}
            className="p-1 text-gray-400 hover:text-brand-dark"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete} className="p-1 text-gray-400 hover:text-red-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: OpsTask['status'] }) {
  const map: Record<OpsTask['status'], { label: string; cls: string }> = {
    OPEN: { label: 'Öppen', cls: 'bg-gray-100 text-gray-700' },
    IN_PROGRESS: { label: 'Pågår', cls: 'bg-blue-100 text-blue-800' },
    WAITING: { label: 'Väntar', cls: 'bg-amber-100 text-amber-800' },
    DONE: { label: 'Klar', cls: 'bg-emerald-100 text-emerald-800' },
    CANCELLED: { label: 'Avbruten', cls: 'bg-gray-100 text-gray-400' },
  };
  const v = map[status];
  return <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${v.cls}`}>{v.label}</span>;
}

function TaskEditor({
  section,
  task,
  onClose,
  onSaved,
}: {
  section: 'PIPELINE' | 'ACTION' | 'PERSONAL';
  task: OpsTask | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!task;
  const [title, setTitle] = useState(task?.title ?? '');
  const [owner, setOwner] = useState(task?.owner ?? '');
  const [relatedTo, setRelatedTo] = useState(task?.relatedTo ?? '');
  const [nextStep, setNextStep] = useState(task?.nextStep ?? '');
  const [status, setStatus] = useState<OpsTask['status']>(task?.status ?? 'OPEN');
  const [deadline, setDeadline] = useState<string>(task?.deadline ? task.deadline.slice(0, 10) : '');
  const [notes, setNotes] = useState(task?.notes ?? '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        section,
        title,
        owner: owner || null,
        relatedTo: relatedTo || null,
        nextStep: nextStep || null,
        status,
        deadline: deadline || null,
        notes: notes || null,
      };
      if (isEdit) {
        await api(`/api/ops/tasks/${task!.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await api(`/api/ops/tasks`, { method: 'POST', body: JSON.stringify(body) });
      }
      onSaved();
    } catch (e) {
      alert(`Fel: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-3 max-h-[90vh] overflow-auto">
        <div className="flex justify-between items-center">
          <h3 className="font-serif text-lg">
            {isEdit ? 'Redigera' : 'Ny'} {section === 'PIPELINE' ? 'pipeline-rad' : section === 'ACTION' ? 'action' : 'personlig task'}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-800">
            <X className="w-5 h-5" />
          </button>
        </div>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titel"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder={section === 'PERSONAL' ? 'Person (t.ex. Mikaela)' : 'Ansvarig'}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
          <input
            value={relatedTo}
            onChange={(e) => setRelatedTo(e.target.value)}
            placeholder="Kopplad till (kund/anställd)"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <textarea
          value={nextStep}
          onChange={(e) => setNextStep(e.target.value)}
          placeholder="Nästa steg"
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as OpsTask['status'])}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          >
            <option value="OPEN">Öppen</option>
            <option value="IN_PROGRESS">Pågår</option>
            <option value="WAITING">Väntar</option>
            <option value="DONE">Klar</option>
            <option value="CANCELLED">Avbruten</option>
          </select>
          <input
            type="date"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm"
          />
        </div>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Anteckningar"
          rows={2}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600">
            Avbryt
          </button>
          <button
            onClick={save}
            disabled={saving || !title.trim()}
            className="px-3 py-1.5 bg-brand-accent text-white rounded-lg text-sm disabled:opacity-50"
          >
            {saving ? 'Sparar...' : 'Spara'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function formatValue(v: number, unit: string | null): string {
  const formatted = new Intl.NumberFormat('sv-SE').format(v);
  return `${formatted} ${unit ?? ''}`.trim();
}

function formatPeriodLabel(start: string, end: string, type: 'YEAR' | 'MONTH' | 'WEEK'): string {
  const s = new Date(start);
  const e = new Date(end);
  if (type === 'YEAR') {
    return `${s.toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' })} – ${e.toLocaleDateString(
      'sv-SE',
      { month: 'short', year: 'numeric' }
    )}`;
  }
  if (type === 'MONTH') {
    return s.toLocaleDateString('sv-SE', { month: 'long', year: 'numeric' });
  }
  return `Vecka ${getISOWeek(s)} (${s.toLocaleDateString('sv-SE', {
    day: 'numeric',
    month: 'short',
  })} – ${e.toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })})`;
}

function getISOWeek(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}
