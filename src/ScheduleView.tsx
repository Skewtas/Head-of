import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  MapPin,
  Plus,
  UserPlus,
  X,
} from 'lucide-react';
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { api } from './lib/api';
import { useClientAlertGate } from './components/ClientAlertModal';

// ---------- Types ----------
interface Mission {
  id: number;
  date: string;
  plannedStart: string;
  plannedEnd: string;
  plannedCrewSize: number;
  plannedDurationMinutes: number;
  status:
    | 'PLANNED'
    | 'ASSIGNED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'CANCELLED'
    | 'NO_SHOW';
  version: number;
  client: { id: number; name: string; clientNumber: string };
  service: { id: number; name: string };
  assignments: Array<{
    id: number;
    employeeId: number;
    role: 'LEAD' | 'MEMBER';
    employee: { id: number; firstName: string; lastName: string };
  }>;
  _count: { timeEntries: number };
}

interface Employee {
  id: number;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'INACTIVE';
}

type ViewMode = 'day' | 'week';

const STATUS_COLORS: Record<Mission['status'], string> = {
  PLANNED: 'bg-gray-200 text-gray-800 border-gray-300',
  ASSIGNED: 'bg-blue-100 text-blue-900 border-blue-300',
  IN_PROGRESS: 'bg-green-100 text-green-900 border-green-400',
  COMPLETED: 'bg-emerald-100 text-emerald-900 border-emerald-400',
  CANCELLED: 'bg-red-50 text-red-700 border-red-300 line-through opacity-70',
  NO_SHOW: 'bg-orange-100 text-orange-900 border-orange-400',
};

export default function ScheduleView() {
  const [mode, setMode] = useState<ViewMode>('week');
  const [cursor, setCursor] = useState<Date>(() => startOfWeek(new Date()));
  const [missions, setMissions] = useState<Mission[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Mission | null>(null);
  const [activeDrag, setActiveDrag] = useState<Mission | null>(null);
  const { gate, modal } = useClientAlertGate();

  const range = useMemo(() => {
    if (mode === 'day') {
      return { from: startOfDay(cursor), to: endOfDay(cursor) };
    }
    return { from: cursor, to: addDays(cursor, 7) };
  }, [mode, cursor]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      q.set('from', range.from.toISOString().slice(0, 10));
      q.set('to', range.to.toISOString().slice(0, 10));
      const [missionRes, empRes] = await Promise.all([
        api<{ data: Mission[] }>(`/api/missions?${q}`),
        api<{ data: Employee[] }>(`/api/employees?status=ACTIVE&pageSize=200`),
      ]);
      setMissions(missionRes.data);
      setEmployees(empRes.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function onDragStart(e: DragStartEvent) {
    const m = missions.find((x) => x.id === Number(e.active.id));
    if (m) setActiveDrag(m);
  }

  async function onDragEnd(e: DragEndEvent) {
    setActiveDrag(null);
    const missionId = Number(e.active.id);
    const mission = missions.find((m) => m.id === missionId);
    if (!mission || !e.over) return;
    const dropId = String(e.over.id);
    // Parse "emp:{id}:date:{yyyy-mm-dd}"
    const m = dropId.match(/^emp:(\d+):date:(\d{4}-\d{2}-\d{2})$/);
    if (!m) return;
    const employeeId = Number(m[1]);
    const newDate = m[2];
    const curDate = mission.date.slice(0, 10);
    const curEmpIds = mission.assignments.map((a) => a.employeeId);

    try {
      // If date changed, reschedule to same time
      if (newDate !== curDate) {
        const start = new Date(mission.plannedStart);
        const end = new Date(mission.plannedEnd);
        const newStart = new Date(newDate + 'T' + start.toISOString().slice(11, 19));
        const newEnd = new Date(newStart.getTime() + (end.getTime() - start.getTime()));
        await api(`/api/missions/${mission.id}/reschedule`, {
          method: 'POST',
          body: JSON.stringify({ newStart: newStart.toISOString(), newEnd: newEnd.toISOString() }),
        });
      }
      // If employee not assigned, assign (only — keep existing crew intact)
      if (!curEmpIds.includes(employeeId)) {
        await api(`/api/missions/${mission.id}/assign`, {
          method: 'POST',
          body: JSON.stringify({ employeeIds: [employeeId] }),
        });
      }
      await loadData();
    } catch (err) {
      alert(`Kunde inte flytta: ${(err as Error).message}`);
    }
  }

  const openMission = (m: Mission) => {
    gate(m.client.id, m.client.name, () => setSelected(m));
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-white/80 backdrop-blur">
        <div className="flex items-center gap-2">
          <ViewToggle mode={mode} onChange={setMode} />
          <button
            onClick={() =>
              setCursor(mode === 'day' ? addDays(cursor, -1) : addDays(cursor, -7))
            }
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCursor(mode === 'day' ? new Date() : startOfWeek(new Date()))}
            className="px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100"
          >
            Idag
          </button>
          <button
            onClick={() =>
              setCursor(mode === 'day' ? addDays(cursor, 1) : addDays(cursor, 7))
            }
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          <span className="ml-4 text-sm font-medium text-gray-700">
            {formatRange(range.from, range.to)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <span className="text-xs text-gray-400">Laddar…</span>}
          <button
            onClick={async () => {
              const until = addDays(new Date(), 60).toISOString().slice(0, 10);
              await api('/api/jobs/generate-missions', {
                method: 'POST',
                body: JSON.stringify({ daysAhead: 60 }),
              });
              await loadData();
            }}
            className="text-xs px-3 py-1.5 bg-gray-100 rounded-lg hover:bg-gray-200"
          >
            Generera 60 dgr
          </button>
        </div>
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="flex-1 overflow-auto bg-gray-50">
          {mode === 'week' ? (
            <WeekGrid
              weekStart={cursor}
              employees={employees}
              missions={missions}
              onOpenMission={openMission}
            />
          ) : (
            <DayList
              date={cursor}
              missions={missions}
              employees={employees}
              onOpenMission={openMission}
            />
          )}
        </div>
        <DragOverlay>
          {activeDrag ? (
            <div className="pointer-events-none scale-105">
              <MissionChip mission={activeDrag} onClick={() => {}} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {modal}
      {selected && (
        <MissionDrawer
          missionId={selected.id}
          onClose={() => setSelected(null)}
          onChanged={loadData}
          employees={employees}
        />
      )}
    </div>
  );
}

// ---------- Week grid ----------

function WeekGrid({
  weekStart,
  employees,
  missions,
  onOpenMission,
}: {
  weekStart: Date;
  employees: Employee[];
  missions: Mission[];
  onOpenMission: (m: Mission) => void;
}) {
  const days = useMemo(() => Array.from({ length: 7 }).map((_, i) => addDays(weekStart, i)), [weekStart]);

  // Build: employeeId -> dateStr -> Mission[]
  const grid = useMemo(() => {
    const map = new Map<string, Mission[]>();
    for (const m of missions) {
      const date = m.date.slice(0, 10);
      const empIds = m.assignments.map((a) => a.employeeId);
      const keys = empIds.length > 0 ? empIds.map((id) => `${id}:${date}`) : [`0:${date}`];
      for (const k of keys) {
        const arr = map.get(k) ?? [];
        arr.push(m);
        map.set(k, arr);
      }
    }
    return map;
  }, [missions]);

  // Include a special "Otilldelad" row for missions with no assignments
  const rows = useMemo(
    () => [{ id: 0, firstName: 'Otilldelad', lastName: '' } as Employee, ...employees],
    [employees]
  );

  return (
    <div className="min-w-[900px]">
      <div className="grid grid-cols-[180px_repeat(7,minmax(140px,1fr))] border-b border-gray-200 sticky top-0 bg-white z-10">
        <div className="p-3 text-xs font-medium text-gray-500 uppercase">Anställd</div>
        {days.map((d) => (
          <div key={d.toISOString()} className="p-3 border-l border-gray-100 text-center">
            <div className="text-xs uppercase text-gray-400">
              {d.toLocaleDateString('sv-SE', { weekday: 'short' })}
            </div>
            <div className="text-sm font-medium">
              {d.getDate()}/{d.getMonth() + 1}
            </div>
          </div>
        ))}
      </div>
      {rows.map((emp) => (
        <div
          key={emp.id}
          className="grid grid-cols-[180px_repeat(7,minmax(140px,1fr))] border-b border-gray-100"
        >
          <div className="p-3 text-sm bg-white sticky left-0 z-[1]">
            {emp.id === 0 ? (
              <span className="text-red-600 font-medium">Otilldelad</span>
            ) : (
              <>
                <div className="font-medium">{emp.firstName}</div>
                <div className="text-xs text-gray-400">{emp.lastName}</div>
              </>
            )}
          </div>
          {days.map((d) => {
            const dateStr = d.toISOString().slice(0, 10);
            const cellMissions = grid.get(`${emp.id}:${dateStr}`) ?? [];
            return (
              <DroppableCell key={dateStr} employeeId={emp.id} dateStr={dateStr}>
                {cellMissions.map((m) => (
                  <DraggableMission key={m.id} mission={m}>
                    <MissionChip mission={m} onClick={() => onOpenMission(m)} />
                  </DraggableMission>
                ))}
              </DroppableCell>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function DroppableCell({
  employeeId,
  dateStr,
  children,
}: {
  employeeId: number;
  dateStr: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `emp:${employeeId}:date:${dateStr}`,
  });
  return (
    <div
      ref={setNodeRef}
      className={`min-h-[68px] p-1 border-l border-gray-100 ${
        isOver ? 'bg-brand-accent/10' : 'bg-white'
      }`}
    >
      {children}
    </div>
  );
}

function DraggableMission({ mission, children }: { mission: Mission; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: mission.id,
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={isDragging ? 'opacity-30' : ''}
    >
      {children}
    </div>
  );
}

function MissionChip({
  mission,
  onClick,
}: {
  mission: Mission;
  onClick: () => void;
}) {
  const startTime = new Date(mission.plannedStart).toLocaleTimeString('sv-SE', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`w-full text-left p-1.5 mb-1 text-xs rounded border ${STATUS_COLORS[mission.status]}`}
    >
      <div className="flex items-center gap-1">
        <Clock className="w-3 h-3" />
        <span className="font-medium">{startTime}</span>
        <span className="text-[10px] opacity-70 ml-auto">
          {mission.plannedDurationMinutes}m
        </span>
      </div>
      <div className="truncate font-medium mt-0.5">{mission.client.name}</div>
      <div className="truncate text-[11px] opacity-80">{mission.service.name}</div>
      {mission.assignments.length < mission.plannedCrewSize && mission.status !== 'CANCELLED' && (
        <div className="flex items-center gap-1 mt-1 text-red-700">
          <AlertTriangle className="w-3 h-3" /> {mission.assignments.length}/{mission.plannedCrewSize}
        </div>
      )}
    </button>
  );
}

// ---------- Day list ----------

function DayList({
  date,
  missions,
  employees,
  onOpenMission,
}: {
  date: Date;
  missions: Mission[];
  employees: Employee[];
  onOpenMission: (m: Mission) => void;
}) {
  const dayMissions = missions
    .filter((m) => m.date.slice(0, 10) === date.toISOString().slice(0, 10))
    .sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));

  return (
    <div className="p-6">
      {dayMissions.length === 0 && (
        <div className="text-center text-gray-400 py-20">
          <CalendarDays className="w-12 h-12 mx-auto mb-2 opacity-40" />
          Inga pass denna dag
        </div>
      )}
      <div className="space-y-2 max-w-3xl">
        {dayMissions.map((m) => (
          <div
            key={m.id}
            onClick={() => onOpenMission(m)}
            className={`p-4 rounded-xl border cursor-pointer ${STATUS_COLORS[m.status]}`}
          >
            <div className="flex items-center gap-3">
              <Clock className="w-4 h-4" />
              <span className="font-medium">
                {new Date(m.plannedStart).toLocaleTimeString('sv-SE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
                {' – '}
                {new Date(m.plannedEnd).toLocaleTimeString('sv-SE', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="font-semibold ml-2">{m.client.name}</span>
              <span className="text-xs ml-auto">
                {m.assignments.length}/{m.plannedCrewSize} pers.
              </span>
            </div>
            <div className="text-sm mt-2 opacity-80">{m.service.name}</div>
            {m.assignments.length > 0 && (
              <div className="text-xs mt-2">
                {m.assignments.map((a) => `${a.employee.firstName} ${a.employee.lastName}`).join(', ')}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Mission drawer ----------

function MissionDrawer({
  missionId,
  onClose,
  onChanged,
  employees,
}: {
  missionId: number;
  onClose: () => void;
  onChanged: () => void;
  employees: Employee[];
}) {
  const [mission, setMission] = useState<any>(null);
  const [adding, setAdding] = useState(false);
  const reload = useCallback(async () => {
    const m = await api<any>(`/api/missions/${missionId}`);
    setMission(m);
  }, [missionId]);
  useEffect(() => {
    reload();
  }, [reload]);

  if (!mission) {
    return <Drawer onClose={onClose}><div className="p-6 text-gray-400">Laddar…</div></Drawer>;
  }

  const assign = async (employeeId: number) => {
    await api(`/api/missions/${missionId}/assign`, {
      method: 'POST',
      body: JSON.stringify({ employeeIds: [employeeId] }),
    });
    await reload();
    onChanged();
  };
  const unassign = async (employeeId: number) => {
    await api(`/api/missions/${missionId}/assign/${employeeId}`, { method: 'DELETE' });
    await reload();
    onChanged();
  };
  const cancel = async () => {
    const reason = prompt('Anledning till avbokning:');
    if (!reason) return;
    const billable = confirm('Ska avbokningen debiteras (mindre än 24h)?');
    await api(`/api/missions/${missionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason, billable }),
    });
    await reload();
    onChanged();
  };
  const duplicate = async () => {
    const newDate = prompt(`Duplicera till datum (YYYY-MM-DD):`, mission.date.slice(0, 10));
    if (!newDate) return;
    await api(`/api/missions/${missionId}/duplicate`, {
      method: 'POST',
      body: JSON.stringify({ newDate }),
    });
    onChanged();
    onClose();
  };

  const assignedIds = mission.assignments.map((a: any) => a.employeeId);
  const availableEmployees = employees.filter((e) => !assignedIds.includes(e.id));

  return (
    <Drawer onClose={onClose}>
      <div className="p-6 border-b border-gray-100">
        <div className="flex justify-between">
          <div>
            <p className="text-xs text-gray-400">#{mission.id} · v{mission.version}</p>
            <h2 className="text-xl font-serif">{mission.client.name}</h2>
            <p className="text-sm text-gray-600 mt-1">
              {new Date(mission.plannedStart).toLocaleString('sv-SE')} –{' '}
              {new Date(mission.plannedEnd).toLocaleTimeString('sv-SE', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
            <div className="mt-2 inline-block text-xs px-2 py-0.5 rounded-full border">{mission.status}</div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="p-6 space-y-6 overflow-auto flex-1">
        <section>
          <h3 className="text-xs uppercase text-gray-400 mb-2">Tjänst</h3>
          <p className="text-sm">{mission.service.name}</p>
          <p className="text-xs text-gray-500 mt-1">
            Planerad tid: {mission.plannedDurationMinutes} min · Bemanning:{' '}
            {mission.assignments.length}/{mission.plannedCrewSize}
          </p>
        </section>

        <section>
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-xs uppercase text-gray-400">Personal</h3>
            <button
              onClick={() => setAdding((v) => !v)}
              className="text-xs text-brand-accent flex items-center gap-1"
            >
              <UserPlus className="w-3 h-3" /> Lägg till
            </button>
          </div>
          {mission.assignments.length === 0 && (
            <p className="text-sm text-gray-400 italic">Ingen tilldelad</p>
          )}
          <ul className="space-y-1">
            {mission.assignments.map((a: any) => (
              <li
                key={a.id}
                className="flex items-center justify-between p-2 bg-gray-50 rounded-lg text-sm"
              >
                <span>
                  {a.employee.firstName} {a.employee.lastName}
                  <span className="ml-2 text-xs text-gray-400">{a.role}</span>
                </span>
                <button
                  onClick={() => unassign(a.employeeId)}
                  className="text-xs text-red-600 hover:underline"
                >
                  Ta bort
                </button>
              </li>
            ))}
          </ul>
          {adding && (
            <div className="mt-2 p-2 bg-gray-50 rounded-lg">
              <select
                className="w-full px-2 py-1 text-sm border border-gray-200 rounded"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    assign(Number(e.target.value));
                    setAdding(false);
                  }
                }}
              >
                <option value="">Välj anställd…</option>
                {availableEmployees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </div>
          )}
        </section>

        {mission.timeEntries.length > 0 && (
          <section>
            <h3 className="text-xs uppercase text-gray-400 mb-2">Tidrapporter</h3>
            <ul className="space-y-1">
              {mission.timeEntries.map((t: any) => (
                <li key={t.id} className="p-2 bg-gray-50 rounded-lg text-xs">
                  <div className="font-medium">
                    {t.employee.firstName} {t.employee.lastName}
                  </div>
                  <div className="text-gray-500">
                    {t.checkInAt
                      ? new Date(t.checkInAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
                      : '–'}{' '}
                    –{' '}
                    {t.checkOutAt
                      ? new Date(t.checkOutAt).toLocaleTimeString('sv-SE', { hour: '2-digit', minute: '2-digit' })
                      : 'pågår'}
                    {t.actualMinutes != null && ` · ${t.actualMinutes} min`}
                    {t.deviationType !== 'NONE' && (
                      <span className="ml-2 text-orange-600">{t.deviationType}</span>
                    )}
                  </div>
                  {t.adminApprovedAt && (
                    <div className="text-green-700 text-[10px]">Godkänd</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {mission.customerInstructions && (
          <section>
            <h3 className="text-xs uppercase text-gray-400 mb-2">Kundinstruktioner</h3>
            <p className="text-sm whitespace-pre-wrap">{mission.customerInstructions}</p>
          </section>
        )}
        {mission.internalNotes && (
          <section>
            <h3 className="text-xs uppercase text-gray-400 mb-2">Interna noteringar</h3>
            <p className="text-sm whitespace-pre-wrap">{mission.internalNotes}</p>
          </section>
        )}
      </div>

      <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-2">
        <button
          onClick={duplicate}
          className="flex items-center gap-1 px-3 py-2 text-sm rounded-lg hover:bg-white"
        >
          <Copy className="w-4 h-4" /> Duplicera
        </button>
        {mission.status !== 'CANCELLED' && mission.status !== 'COMPLETED' && (
          <button
            onClick={cancel}
            className="flex items-center gap-1 px-3 py-2 text-sm text-red-700 rounded-lg hover:bg-red-50 ml-auto"
          >
            <X className="w-4 h-4" /> Avboka
          </button>
        )}
      </div>
    </Drawer>
  );
}

// ---------- Toolbar ----------

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="flex bg-gray-100 rounded-lg p-0.5 text-xs">
      {(['day', 'week'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={`px-3 py-1.5 rounded-md ${
            mode === m ? 'bg-white shadow text-gray-900' : 'text-gray-500'
          }`}
        >
          {m === 'day' ? 'Dag' : 'Vecka'}
        </button>
      ))}
    </div>
  );
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-xl bg-white shadow-2xl flex flex-col">{children}</div>
    </div>
  );
}

// ---------- Date helpers ----------

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  const dow = (out.getDay() + 6) % 7; // Mon=0
  out.setDate(out.getDate() - dow);
  return out;
}
function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
function endOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(23, 59, 59, 999);
  return out;
}
function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}
function formatRange(from: Date, to: Date): string {
  const sameMonth = from.getMonth() === to.getMonth();
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  return sameMonth
    ? `${from.getDate()}–${to.getDate()} ${from.toLocaleDateString('sv-SE', { month: 'long' })}`
    : `${from.toLocaleDateString('sv-SE', opts)} – ${to.toLocaleDateString('sv-SE', opts)}`;
}
