import React, { useState, useMemo, useEffect } from 'react';
import { 
  DndContext, 
  DragOverlay, 
  closestCenter, 
  KeyboardSensor, 
  PointerSensor, 
  useSensor, 
  useSensors,
  useDraggable,
  useDroppable
} from '@dnd-kit/core';
import { 
  Search, Filter, MapPin, Clock, AlertCircle, Car, Train, 
  CheckCircle2, XCircle, Calendar, Zap, Settings2, User, X, RefreshCw
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { timewaveService } from './services/timewaveService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- TYPES ---
export type TransportMode = 'SL' | 'CAR';
export type JobStatus = 'UNASSIGNED' | 'ASSIGNED' | 'COMPLETED' | 'CANCELLED';
export type CleanerStatus = 'WORKING' | 'OFF' | 'SICK';

export interface Cleaner {
  id: string;
  name: string;
  status: CleanerStatus;
  transportMode: TransportMode;
}

export interface Job {
  id: string;
  customerName: string;
  areaCode: string;
  type: string;
  priority: 'HIGH' | 'NORMAL' | 'LOW';
  estMinutes: number;
  notes: string;
  status: JobStatus;
  cleanerId: string | null;
  dayIndex: number | null; // 0 = Mon, 6 = Sun
  startMin: number | null; // minutes from midnight
  endMin: number | null;
}

// --- MOCK DATA ---
const CLEANER_NAMES = [
  "Luisa", "Elvedina", "Anna", "Maria", "Johan", "Erik", "Sara", "Emma", "Lars", "Mikael",
  "Karin", "Linda", "Anders", "Per", "Karl", "Eva", "Marie", "Lena", "Thomas", "Jan",
  "Peter", "Helena", "Katarina", "Hans", "Bengt", "Olof", "Bo", "Nils", "Sven", "Margareta"
];

const mockCleaners: Cleaner[] = CLEANER_NAMES.map((name, i) => ({
  id: `c${i + 1}`,
  name,
  status: i % 10 === 0 ? 'OFF' : i % 15 === 0 ? 'SICK' : 'WORKING',
  transportMode: (name === 'Luisa' || name === 'Elvedina') ? 'CAR' : 'SL'
}));

const mockJobs: Job[] = Array.from({ length: 20 }).map((_, i) => ({
  id: `j${i + 1}`,
  customerName: `Kund ${i + 1} AB`,
  areaCode: ['Södermalm', 'Östermalm', 'Vasastan', 'Kungsholmen', 'Solna'][i % 5],
  type: ['Hemstäd', 'Kontorsstäd', 'Flyttstäd', 'Fönsterputs'][i % 4],
  priority: i % 7 === 0 ? 'HIGH' : i % 3 === 0 ? 'LOW' : 'NORMAL',
  estMinutes: [60, 90, 120, 180, 240][i % 5],
  notes: 'Viktig kund, var noggrann.',
  status: 'UNASSIGNED',
  cleanerId: null,
  dayIndex: null,
  startMin: null,
  endMin: null
}));

// --- UTILS ---
export const getTravelMinutes = ({ mode, fromArea, toArea, departTimeMin }: { mode: TransportMode, fromArea: string, toArea: string, departTimeMin?: number }) => {
  // TODO: Fetch SL travel time via API
  // TODO: Use real geo coordinates
  if (fromArea === toArea) return 15;
  return mode === 'CAR' ? 20 : 35;
};

export const detectConflicts = (jobs: Job[], cleanerId: string, dayIndex: number) => {
  const cleanerJobs = jobs.filter(j => j.cleanerId === cleanerId && j.dayIndex === dayIndex).sort((a, b) => (a.startMin || 0) - (b.startMin || 0));
  const conflicts = new Set<string>();
  
  for (let i = 0; i < cleanerJobs.length - 1; i++) {
    const current = cleanerJobs[i];
    const next = cleanerJobs[i + 1];
    if (current.endMin && next.startMin) {
      const travelTime = getTravelMinutes({ 
        mode: mockCleaners.find(c => c.id === cleanerId)?.transportMode || 'SL', 
        fromArea: current.areaCode, 
        toArea: next.areaCode 
      });
      if (current.endMin + travelTime > next.startMin) {
        conflicts.add(current.id);
        conflicts.add(next.id);
      }
    }
  }
  return conflicts;
};

export const calcWeeklyHours = (jobs: Job[], cleanerId: string) => {
  return jobs.filter(j => j.cleanerId === cleanerId).reduce((acc, j) => acc + (j.estMinutes / 60), 0);
};

export const scoreCandidate = (job: Job, cleaner: Cleaner, dayIndex: number, startMin: number, allJobs: Job[]) => {
  if (cleaner.status !== 'WORKING') return { score: -1000, reasons: ['Not working'] };
  
  let score = 0;
  const reasons: string[] = [];
  
  const cleanerJobs = allJobs.filter(j => j.cleanerId === cleaner.id && j.dayIndex === dayIndex).sort((a, b) => (a.startMin || 0) - (b.startMin || 0));
  
  // Check overlap
  const endMin = startMin + job.estMinutes;
  const hasOverlap = cleanerJobs.some(j => (j.startMin! < endMin && j.endMin! > startMin));
  if (hasOverlap) return { score: -1000, reasons: ['Overlap'] };

  // Find prev and next jobs
  const prevJob = [...cleanerJobs].reverse().find(j => j.endMin! <= startMin);
  const nextJob = cleanerJobs.find(j => j.startMin! >= endMin);

  if (prevJob) {
    const travelTime = getTravelMinutes({ mode: cleaner.transportMode, fromArea: prevJob.areaCode, toArea: job.areaCode });
    if (prevJob.endMin! + travelTime > startMin) {
      score -= 50;
      reasons.push('Hinner ej (restid från föregående)');
    } else if (prevJob.areaCode === job.areaCode) {
      score += 50;
      reasons.push('Samma område');
    } else if (travelTime <= 15) {
      score += 30;
      reasons.push('Kort restid (≤15m)');
    }
    
    const gap = startMin - prevJob.endMin!;
    if (gap > travelTime && gap < travelTime + 60) {
      score += 20;
      reasons.push('Fyller lucka');
    } else if (gap > 120) {
      score -= 40;
      reasons.push('Skapar stor lucka');
    }
  }

  if (nextJob) {
    const travelTime = getTravelMinutes({ mode: cleaner.transportMode, fromArea: job.areaCode, toArea: nextJob.areaCode });
    if (endMin + travelTime > nextJob.startMin!) {
      score -= 50;
      reasons.push('Hinner ej (restid till nästa)');
    }
  }

  const weeklyHours = calcWeeklyHours(allJobs, cleaner.id);
  if (weeklyHours < 30) {
    score += 10;
    reasons.push('Låg beläggning');
  } else if (weeklyHours + (job.estMinutes / 60) > 40) {
    score -= 60;
    reasons.push('Övertid');
  }

  return { score, reasons };
};

export const suggestForJob = (job: Job, cleaners: Cleaner[], allJobs: Job[], horizonDays: number = 5) => {
  const suggestions = [];
  for (const cleaner of cleaners) {
    for (let dayIndex = 0; dayIndex < horizonDays; dayIndex++) {
      // Try slots from 08:00 to 16:00
      for (let startMin = 8 * 60; startMin <= 16 * 60; startMin += 30) {
        const { score, reasons } = scoreCandidate(job, cleaner, dayIndex, startMin, allJobs);
        if (score > -500) {
          suggestions.push({ cleaner, dayIndex, startMin, score, reasons });
        }
      }
    }
  }
  return suggestions.sort((a, b) => b.score - a.score).slice(0, 3);
};

// --- COMPONENTS ---

const DraggableJobCard = ({ job, isOverlay = false }: { job: Job, isOverlay?: boolean }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
    data: { type: 'JOB', job }
  });

  const colors: Record<string, string> = {
    'Hemstäd': 'bg-blue-50 border-blue-100 text-blue-800',
    'Kontorsstäd': 'bg-emerald-50 border-emerald-100 text-emerald-800',
    'Flyttstäd': 'bg-purple-50 border-purple-100 text-purple-800',
    'Fönsterputs': 'bg-amber-50 border-amber-100 text-amber-800',
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={cn(
        "p-3 rounded-2xl border shadow-sm cursor-grab active:cursor-grabbing transition-all",
        colors[job.type] || 'bg-gray-50 border-gray-200 text-brand-dark',
        isDragging && !isOverlay ? "opacity-30" : "opacity-100",
        isOverlay && "shadow-xl scale-105 rotate-2"
      )}
    >
      <div className="flex justify-between items-start mb-1">
        <span className="font-semibold text-sm truncate pr-2">{job.customerName}</span>
        {job.priority === 'HIGH' && <AlertCircle className="w-4 h-4 text-brand-accent shrink-0" />}
      </div>
      <div className="flex items-center gap-1 text-xs opacity-80 mb-1">
        <MapPin className="w-3 h-3" /> {job.areaCode}
      </div>
      <div className="flex justify-between items-center text-xs opacity-80 font-medium">
        <span>{job.type}</span>
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {job.estMinutes}m</span>
      </div>
    </div>
  );
};

const DroppableSlot = ({ id, cleanerId, dayIndex, startMin, children, isConflict }: any) => {
  const { isOver, setNodeRef } = useDroppable({
    id,
    data: { type: 'SLOT', cleanerId, dayIndex, startMin }
  });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-12 border-b border-gray-100 border-r relative transition-colors",
        isOver ? "bg-brand-accent/10/50" : "bg-white",
        isConflict && "ring-2 ring-inset ring-rose-300 bg-brand-accent/10/20"
      )}
    >
      {children}
    </div>
  );
};

const ScheduledJob = ({ job, isConflict, onClick }: { job: Job, isConflict: boolean, onClick: () => void }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: job.id,
    data: { type: 'JOB', job }
  });

  const height = (job.estMinutes / 30) * 48; // 3rem = 48px

  const colors: Record<string, string> = {
    'Hemstäd': 'bg-blue-100/80 border-blue-200 text-blue-900',
    'Kontorsstäd': 'bg-emerald-100/80 border-emerald-200 text-emerald-900',
    'Flyttstäd': 'bg-purple-100/80 border-purple-200 text-purple-900',
    'Fönsterputs': 'bg-amber-100/80 border-amber-200 text-amber-900',
  };

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn(
        "absolute left-1 right-1 rounded-xl border p-2 shadow-sm cursor-grab active:cursor-grabbing overflow-hidden z-10 backdrop-blur-sm",
        colors[job.type] || 'bg-gray-100 border-gray-200 text-brand-dark',
        isDragging ? "opacity-30" : "opacity-100",
        isConflict && "ring-2 ring-rose-400 shadow-rose-200",
        job.status === 'COMPLETED' && "opacity-60 grayscale"
      )}
      style={{ height: `${height}px`, top: '2px' }}
    >
      <div className="flex justify-between items-start">
        <div className="text-xs font-bold truncate pr-1">{job.customerName}</div>
        {job.status === 'COMPLETED' && <CheckCircle2 className="w-3 h-3 text-emerald-600 shrink-0" />}
      </div>
      <div className="text-[10px] opacity-80 truncate">{job.areaCode}</div>
    </div>
  );
};

// --- MAIN COMPONENT ---
export default function DispatchBoard() {
  const [jobs, setJobs] = useState<Job[]>(mockJobs);
  const [cleaners, setCleaners] = useState<Cleaner[]>(mockCleaners);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [showCapacity, setShowCapacity] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      // Fetch employees (cleaners)
      const employeesRes = await timewaveService.getEmployees();
      if (employeesRes?.data) {
        const mappedCleaners: Cleaner[] = employeesRes.data.map((emp: any) => ({
          id: String(emp.number || emp.id),
          name: `${emp.first_name} ${emp.last_name}`,
          status: emp.status === "1" ? 'WORKING' : 'OFF',
          transportMode: emp.car === 'NO_CAR' ? 'SL' : 'CAR'
        }));
        setCleaners(mappedCleaners);
      }

      // Fetch schedule (missions) for the current week
      // Get current date and end of week
      const today = new Date();
      const endOfWeek = new Date();
      endOfWeek.setDate(today.getDate() + 7);
      
      const startStr = today.toISOString().split('T')[0];
      const endStr = endOfWeek.toISOString().split('T')[0];

      const missionsRes = await timewaveService.getSchedule(startStr, endStr);
      if (missionsRes?.data) {
        const mappedJobs: Job[] = missionsRes.data.map((mission: any) => {
          // Calculate start and end minutes from midnight
          let startMin = null;
          let endMin = null;
          let dayIndex = null;
          let estMinutes = 120; // Default 2 hours
          
          if (mission.startdate && mission.starttime) {
            const [hours, minutes] = mission.starttime.split(':').map(Number);
            startMin = hours * 60 + minutes;
            
            // Calculate day index (0 = Monday, etc.)
            const missionDate = new Date(mission.startdate);
            dayIndex = (missionDate.getDay() + 6) % 7; // Convert Sunday=0 to Monday=0
          }
          
          if (mission.endtime) {
            const [hours, minutes] = mission.endtime.split(':').map(Number);
            endMin = hours * 60 + minutes;
            if (startMin !== null) {
              estMinutes = endMin - startMin;
            }
          }

          return {
            id: String(mission.bookingline_id || mission.id),
            customerName: `Kund ${mission.client_id || 'Okänd'}`, // We might need to fetch client details separately or if included
            areaCode: 'Stockholm', // Defaulting, would need workarea mapping
            type: 'Städning', // Defaulting
            priority: 'NORMAL',
            estMinutes,
            notes: mission.comment || '',
            status: mission.employee_id ? 'ASSIGNED' : 'UNASSIGNED',
            cleanerId: mission.employee_id ? String(mission.employee_id) : null,
            dayIndex,
            startMin,
            endMin
          };
        });
        setJobs(mappedJobs);
      }
      
      showToast("Data hämtad från Timewave");
    } catch (error) {
      console.error("Failed to fetch Timewave data:", error);
      showToast("Kunde inte hämta data från Timewave. Använder testdata.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const handleDragStart = (event: any) => {
    setActiveId(event.active.id);
  };

  const handleDragEnd = (event: any) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const job = active.data.current?.job as Job;
    const slot = over.data.current;

    if (slot?.type === 'SLOT') {
      // TODO: Persist schedule changes
      setJobs(prev => prev.map(j => {
        if (j.id === job.id) {
          return {
            ...j,
            status: 'ASSIGNED',
            cleanerId: slot.cleanerId,
            dayIndex: slot.dayIndex,
            startMin: slot.startMin,
            endMin: slot.startMin + j.estMinutes
          };
        }
        return j;
      }));

      // Check conflicts after state update
      setTimeout(() => {
        const conflicts = detectConflicts(jobs, slot.cleanerId, slot.dayIndex);
        if (conflicts.size > 0) {
          showToast("Konflikt upptäckt!");
        }
      }, 100);
    } else if (over.id === 'job-pool') {
      setJobs(prev => prev.map(j => j.id === job.id ? { ...j, status: 'UNASSIGNED', cleanerId: null, dayIndex: null, startMin: null, endMin: null } : j));
    }
  };

  const autoAssign = () => {
    let placed = 0;
    let newJobs = [...jobs];
    
    const unassigned = newJobs.filter(j => j.status === 'UNASSIGNED').sort((a, b) => (a.priority === 'HIGH' ? -1 : 1));
    
    for (const job of unassigned) {
      const suggestions = suggestForJob(job, cleaners, newJobs);
      if (suggestions.length > 0) {
        const best = suggestions[0];
        const jobIndex = newJobs.findIndex(j => j.id === job.id);
        newJobs[jobIndex] = {
          ...job,
          status: 'ASSIGNED',
          cleanerId: best.cleaner.id,
          dayIndex: best.dayIndex,
          startMin: best.startMin,
          endMin: best.startMin + job.estMinutes
        };
        placed++;
      }
    }
    
    setJobs(newJobs);
    showToast(`Auto-assign klar: ${placed} placerade, ${unassigned.length - placed} kvar`);
  };

  const unassignedJobs = jobs.filter(j => j.status === 'UNASSIGNED');
  const days = ['Mån', 'Tis', 'Ons', 'Tor', 'Fre'];
  const timeSlots = Array.from({ length: 28 }).map((_, i) => 6 * 60 + i * 30); // 06:00 to 20:00

  const activeJob = useMemo(() => jobs.find(j => j.id === activeId), [activeId, jobs]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="h-screen flex flex-col bg-[#F4F1EB] text-brand-dark  overflow-hidden">
        
        {/* TOP BAR */}
        <header className="h-16 bg-white border-b border-[#E5E0D8] px-6 flex items-center justify-between shrink-0 z-20">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold tracking-tight text-brand-dark">DISPATCH / JOBBPOOL</h1>
            <div className="h-6 w-px bg-gray-200" />
            <span className="text-sm font-medium text-brand-muted">Vecka 42</span>
          </div>
          <div className="flex items-center gap-3">
            <button 
              onClick={fetchData} 
              disabled={isLoading}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-brand-muted rounded-xl text-sm font-bold tracking-wider uppercase hover:bg-gray-50 transition-all disabled:opacity-50"
            >
              <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
              Uppdatera
            </button>
            <button onClick={() => setShowCapacity(!showCapacity)} className={cn("px-4 py-2 rounded-xl text-sm font-bold tracking-wider uppercase transition-all", showCapacity ? "bg-brand-accent/20 text-rose-800" : "bg-gray-100 text-brand-muted hover:bg-gray-200")}>
              Kapacitetsvy
            </button>
            <div className="h-6 w-px bg-gray-200" />
            <button onClick={autoAssign} className="flex items-center gap-2 px-4 py-2 bg-[#A8E6CF]/30 text-emerald-800 border border-[#A8E6CF] rounded-xl text-sm font-bold tracking-wider uppercase hover:bg-[#A8E6CF]/50 transition-all">
              <Zap className="w-4 h-4" /> Auto-Assign
            </button>
          </div>
        </header>

        {/* MAIN CONTENT */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* LEFT: JOB POOL */}
          <div className="w-80 bg-[#FAFAF9] border-r border-[#E5E0D8] flex flex-col shrink-0 z-10">
            <div className="p-4 border-b border-[#E5E0D8] bg-white">
              <div className="relative mb-3">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input type="text" placeholder="Sök jobb..." className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500" />
              </div>
              <div className="flex items-center justify-between text-xs font-bold text-brand-muted uppercase tracking-wider">
                <span>Obokade jobb: {unassignedJobs.length}</span>
                <Filter className="w-4 h-4 cursor-pointer hover:text-brand-dark" />
              </div>
            </div>
            
            <DroppableSlot id="job-pool" className="flex-1 overflow-y-auto p-4 space-y-3">
              {unassignedJobs.map(job => (
                <DraggableJobCard key={job.id} job={job} />
              ))}
              {unassignedJobs.length === 0 && (
                <div className="text-center text-gray-400 text-sm mt-10">Inga obokade jobb</div>
              )}
            </DroppableSlot>
          </div>

          {/* MIDDLE: SCHEDULE GRID */}
          <div className="flex-1 overflow-auto bg-white relative">
            <div className="inline-flex flex-col min-w-full">
              {/* Grid Header */}
              <div className="sticky top-0 z-30 flex bg-white border-b border-[#E5E0D8] shadow-sm">
                <div className="w-64 shrink-0 border-r border-[#E5E0D8] p-4 bg-[#FAFAF9] flex items-center justify-between">
                  <span className="font-bold text-brand-muted text-sm uppercase tracking-wider">Personal ({cleaners.length})</span>
                  <Settings2 className="w-4 h-4 text-gray-400" />
                </div>
                {days.map((day, dIdx) => (
                  <div key={dIdx} className="flex-1 min-w-[300px] border-r border-[#E5E0D8]">
                    <div className="p-2 text-center font-serif text-brand-dark bg-[#F4F1EB]/50 border-b border-[#E5E0D8]">{day}</div>
                    <div className="flex">
                      {timeSlots.filter((_, i) => i % 2 === 0).map((time, i) => (
                        <div key={i} className="flex-1 text-center text-[10px] text-gray-400 py-1 border-r border-gray-100 last:border-0">
                          {Math.floor(time / 60).toString().padStart(2, '0')}:00
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Grid Body */}
              <div className="flex flex-col">
                {cleaners.map(cleaner => {
                  const weeklyHours = calcWeeklyHours(jobs, cleaner.id);
                  const isOvertime = weeklyHours > 40;
                  
                  return (
                    <div key={cleaner.id} className="flex border-b border-[#E5E0D8] hover:bg-gray-50/30 transition-colors group">
                      {/* Cleaner Info */}
                      <div className="w-64 shrink-0 border-r border-[#E5E0D8] p-3 bg-white group-hover:bg-[#FAFAF9] transition-colors sticky left-0 z-20 flex flex-col justify-center">
                        <div className="flex justify-between items-center mb-1">
                          <span className="font-bold text-sm text-brand-dark flex items-center gap-2">
                            {cleaner.name}
                            {cleaner.transportMode === 'CAR' ? <Car className="w-3 h-3 text-gray-400" /> : <Train className="w-3 h-3 text-gray-400" />}
                          </span>
                          <span className={cn("text-[10px] font-bold px-1.5 py-0.5 rounded-md uppercase tracking-wider", 
                            cleaner.status === 'WORKING' ? "bg-[#A8E6CF]/20 text-emerald-700" : 
                            cleaner.status === 'SICK' ? "bg-[#FF6B6B]/20 text-brand-accent" : "bg-gray-100 text-brand-muted"
                          )}>
                            {cleaner.status}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-brand-muted mb-1">
                          <span>{weeklyHours.toFixed(1)}h / 40h</span>
                          {isOvertime && <span className="text-brand-accent font-bold text-[10px] uppercase">Övertid</span>}
                        </div>
                        <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden">
                          <div className={cn("h-full", isOvertime ? "bg-rose-400" : "bg-[#A8E6CF]")} style={{ width: `${Math.min(100, (weeklyHours/40)*100)}%` }} />
                        </div>
                      </div>

                      {/* Days */}
                      {days.map((_, dayIndex) => {
                        const conflicts = detectConflicts(jobs, cleaner.id, dayIndex);
                        
                        return (
                          <div key={dayIndex} className="flex-1 min-w-[300px] border-r border-[#E5E0D8] flex relative bg-white">
                            {/* Time Slots */}
                            {timeSlots.map((time, tIdx) => {
                              const slotId = `slot-${cleaner.id}-${dayIndex}-${time}`;
                              const jobInSlot = jobs.find(j => j.cleanerId === cleaner.id && j.dayIndex === dayIndex && j.startMin === time);
                              
                              return (
                                <div key={tIdx} className="flex-1 relative border-r border-gray-50 last:border-0">
                                  <DroppableSlot 
                                    id={slotId} 
                                    cleanerId={cleaner.id} 
                                    dayIndex={dayIndex} 
                                    startMin={time}
                                    isConflict={false}
                                  >
                                    {jobInSlot && (
                                      <ScheduledJob 
                                        job={jobInSlot} 
                                        isConflict={conflicts.has(jobInSlot.id)}
                                        onClick={() => setSelectedJob(jobInSlot)}
                                      />
                                    )}
                                  </DroppableSlot>
                                </div>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* RIGHT: JOB INSPECTOR */}
          {selectedJob && (
            <div className="w-80 bg-white border-l border-[#E5E0D8] flex flex-col shrink-0 z-20 shadow-xl">
              <div className="p-4 border-b border-[#E5E0D8] flex justify-between items-center bg-[#FAFAF9]">
                <h3 className="font-bold text-sm uppercase tracking-wider text-brand-dark">Job Inspector</h3>
                <button onClick={() => setSelectedJob(null)} className="p-1 hover:bg-gray-200 rounded-lg transition-colors"><X className="w-4 h-4 text-brand-muted" /></button>
              </div>
              
              <div className="p-6 space-y-6 overflow-y-auto">
                <div>
                  <h2 className="text-xl font-serif text-brand-dark mb-1">{selectedJob.customerName}</h2>
                  <div className="flex items-center gap-2 text-sm text-brand-muted">
                    <MapPin className="w-4 h-4" /> {selectedJob.areaCode}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#F4F1EB]/50 p-3 rounded-xl">
                    <div className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-1">Typ</div>
                    <div className="text-sm font-medium text-brand-dark">{selectedJob.type}</div>
                  </div>
                  <div className="bg-[#F4F1EB]/50 p-3 rounded-xl">
                    <div className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-1">Tid</div>
                    <div className="text-sm font-medium text-brand-dark">{selectedJob.estMinutes} min</div>
                  </div>
                </div>

                {selectedJob.cleanerId && (
                  <div className="bg-white border border-gray-200 p-4 rounded-xl shadow-sm">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-brand-accent/20 rounded-full flex items-center justify-center text-brand-accent font-bold">
                        {mockCleaners.find(c => c.id === selectedJob.cleanerId)?.name.charAt(0)}
                      </div>
                      <div>
                        <div className="text-sm font-serif text-brand-dark">{mockCleaners.find(c => c.id === selectedJob.cleanerId)?.name}</div>
                        <div className="text-xs text-brand-muted">Tilldelad städare</div>
                      </div>
                    </div>
                    
                    <div className="space-y-2 pt-3 border-t border-gray-100">
                      <div className="flex justify-between text-xs">
                        <span className="text-brand-muted">Starttid:</span>
                        <span className="font-medium">{Math.floor(selectedJob.startMin! / 60).toString().padStart(2, '0')}:{(selectedJob.startMin! % 60).toString().padStart(2, '0')}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-brand-muted">Transport:</span>
                        <span className="font-medium">{mockCleaners.find(c => c.id === selectedJob.cleanerId)?.transportMode}</span>
                      </div>
                    </div>
                  </div>
                )}

                <div>
                  <div className="text-[10px] font-bold text-brand-muted uppercase tracking-wider mb-2">Anteckningar</div>
                  <p className="text-sm text-brand-muted bg-gray-50 p-3 rounded-xl border border-gray-100">{selectedJob.notes}</p>
                </div>

                <div className="pt-4 border-t border-gray-100 space-y-2">
                  <button 
                    onClick={() => {
                      setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, status: 'COMPLETED' } : j));
                      setSelectedJob(null);
                      showToast("Utcheckad! Feedback-SMS skickas till kunden om 2 timmar.");
                    }}
                    className="w-full py-2.5 bg-gray-900 text-white rounded-xl text-sm font-bold tracking-wider uppercase hover:bg-gray-800 transition-colors"
                  >
                    Checka ut (Markera Klar)
                  </button>
                  <button 
                    onClick={() => {
                      setJobs(prev => prev.map(j => j.id === selectedJob.id ? { ...j, status: 'UNASSIGNED', cleanerId: null, dayIndex: null, startMin: null, endMin: null } : j));
                      setSelectedJob(null);
                    }}
                    className="w-full py-2.5 bg-white border border-gray-200 text-brand-muted rounded-xl text-sm font-bold tracking-wider uppercase hover:bg-gray-50 transition-colors"
                  >
                    Avboka / Återgå till pool
                  </button>
                  <button className="w-full py-2.5 bg-[#faf8f5] border border-[#eae4d9] text-[#5c5750] rounded-xl text-xs font-bold tracking-widest uppercase hover:bg-white transition-colors mt-4">
                    Skapa TimeWave Ärende
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* TOAST */}
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-900 text-white px-6 py-3 rounded-2xl shadow-2xl text-sm font-medium flex items-center gap-3 z-50 animate-in fade-in slide-in-from-bottom-4">
            <AlertCircle className="w-4 h-4 text-brand-accent" />
            {toast}
          </div>
        )}

        {/* DRAG OVERLAY */}
        <DragOverlay>
          {activeJob ? <DraggableJobCard key="overlay" job={activeJob} isOverlay /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}
