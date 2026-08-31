/**
 * HR — Sjukfrånvaro-uppföljning (Fas 1).
 *
 * Läsvy + trigger av manuell skanning. Inga mail skickas i denna fas —
 * "Öppna mall" visar innehållet i ett förhandsgranskningspanel.
 */
import { useEffect, useMemo, useState } from 'react';
import { Heart, RefreshCw, AlertTriangle, Loader, X, ShieldAlert, MessageCircle, FileCheck, Eye } from 'lucide-react';
import { api } from './lib/api';

type Status =
  | 'NEW'
  | 'UNDER_REVIEW'
  | 'EMAIL1_DRAFTED'
  | 'EMAIL1_SENT'
  | 'MEETING_SCHEDULED'
  | 'MEETING_HELD'
  | 'EMAIL2_DRAFTED'
  | 'EMAIL2_SENT'
  | 'RESOLVED'
  | 'DISMISSED';

type Case = {
  id: number;
  timewaveEmployeeId: number;
  employeeName: string;
  episodesCount: number;
  daysCount: number;
  windowStartDate: string;
  windowEndDate: string;
  status: Status;
  notes: string | null;
  dismissReason: string | null;
  meetingDate: string | null;
  metadata: any;
  createdAt: string;
  updatedAt: string;
};

const STATUS_META: Record<Status, { label: string; tone: string; icon: any }> = {
  NEW:               { label: 'Ny — väntar granskning', tone: 'bg-rose-100 text-rose-800',      icon: AlertTriangle },
  UNDER_REVIEW:      { label: 'Under HR-granskning',    tone: 'bg-amber-100 text-amber-800',   icon: Eye },
  EMAIL1_DRAFTED:    { label: 'Omtankesmejl utkast',    tone: 'bg-sky-100 text-sky-800',       icon: MessageCircle },
  EMAIL1_SENT:       { label: 'Omtankesmejl skickat',   tone: 'bg-sky-100 text-sky-900',       icon: MessageCircle },
  MEETING_SCHEDULED: { label: 'Möte bokat',              tone: 'bg-indigo-100 text-indigo-800', icon: MessageCircle },
  MEETING_HELD:      { label: 'Möte genomfört',          tone: 'bg-indigo-100 text-indigo-900', icon: FileCheck },
  EMAIL2_DRAFTED:    { label: 'Beslutsmejl utkast',      tone: 'bg-orange-100 text-orange-800', icon: FileCheck },
  EMAIL2_SENT:       { label: 'Beslut skickat',          tone: 'bg-orange-100 text-orange-900', icon: FileCheck },
  RESOLVED:          { label: 'Avslutat — positivt',     tone: 'bg-emerald-100 text-emerald-800', icon: FileCheck },
  DISMISSED:         { label: 'Avfärdat',                tone: 'bg-gray-100 text-gray-700',     icon: X },
};

function StatusBadge({ status }: { status: Status }) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium ${meta.tone}`}>
      <Icon size={11} />
      {meta.label}
    </span>
  );
}

function TriggerBadge({ trigger }: { trigger: 'STRONG' | 'WARNING' | 'DAYS' | null }) {
  if (!trigger) return null;
  const map: Record<string, { label: string; tone: string }> = {
    STRONG: { label: '≥6 tillfällen', tone: 'bg-rose-600 text-white' },
    WARNING: { label: '4-5 tillfällen', tone: 'bg-amber-500 text-white' },
    DAYS: { label: `≥21 dagar totalt`, tone: 'bg-orange-500 text-white' },
  };
  const t = map[trigger];
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide ${t.tone}`}>
      {t.label}
    </span>
  );
}

export default function HRView() {
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<Status | 'OPEN' | 'ALL'>('OPEN');
  const [scanResult, setScanResult] = useState<any>(null);
  const [accessDenied, setAccessDenied] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ cases: Case[] }>('/api/hr/sick-leave/cases');
      setCases(r.cases || []);
    } catch (e: any) {
      if (e?.status === 403) setAccessDenied(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    if (statusFilter === 'ALL') return cases;
    if (statusFilter === 'OPEN') return cases.filter((c) => c.status !== 'RESOLVED' && c.status !== 'DISMISSED');
    return cases.filter((c) => c.status === statusFilter);
  }, [cases, statusFilter]);

  const runScan = async () => {
    if (scanning) return;
    if (!confirm('Skanna Timewave för sjukfrånvaro senaste 12 månaderna? Nya case skapas för anställda över tröskel.')) return;
    setScanning(true);
    setScanResult(null);
    try {
      const r = await api<any>('/api/hr/sick-leave/scan', { method: 'POST', body: '{}' });
      setScanResult(r);
      await load();
    } catch (e: any) {
      const debug = e?.body?.debug ? `\n\n(${e.body.debug})` : '';
      alert('Skanning misslyckades: ' + (e?.message || 'okänt fel') + debug);
      if (e?.status === 403) setAccessDenied(true);
    } finally {
      setScanning(false);
    }
  };

  if (accessDenied) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <ShieldAlert className="mx-auto text-rose-400" size={48} />
        <h1 className="mt-4 text-xl font-semibold text-brand-dark">HR-modul — åtkomst nekad</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Sjukfrånvaro är känsligt och begränsat till HR-behöriga. Kontakta systemadministratör
          för att lägga till din e-postadress i <code className="bg-gray-100 px-1 rounded">HR_ADMIN_EMAILS</code>.
        </p>
      </div>
    );
  }

  return (
    <div className="p-8 bg-brand-bg min-h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Heart size={20} className="text-rose-500" />
            <h1 className="text-2xl font-semibold text-brand-dark">HR — Sjukfrånvaro</h1>
            <span className="text-[10px] px-2 py-0.5 rounded bg-rose-100 text-rose-700 uppercase tracking-wide font-semibold">
              Sensitivt · HR only
            </span>
          </div>
          <p className="mt-1 text-sm text-brand-muted max-w-2xl">
            Uppföljning av ovanlig eller upprepad sjukfrånvaro. Alla mail granskas manuellt av HR
            innan de skickas — inga automatiska utskick. Frågar aldrig om diagnos.
          </p>
        </div>
        <button
          onClick={runScan}
          disabled={scanning}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-dark text-white text-sm font-medium hover:bg-brand-dark/90 disabled:opacity-50"
        >
          {scanning ? <Loader size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          {scanning ? 'Skannar…' : 'Skanna Timewave nu'}
        </button>
      </div>

      {/* Scan-resultat */}
      {scanResult && (
        <div className="mb-6 p-4 rounded-lg border border-emerald-200 bg-emerald-50">
          <div className="text-sm">
            <strong>Skanning klar.</strong>{' '}
            {scanResult.triggered} anställda över tröskel · {scanResult.created} nya case skapade ·{' '}
            {scanResult.skipped} hoppade över (redan öppna) · fönster {scanResult.windowStart} → {scanResult.windowEnd}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-2 mb-4 text-xs">
        {(['OPEN', 'NEW', 'UNDER_REVIEW', 'EMAIL1_SENT', 'MEETING_HELD', 'RESOLVED', 'DISMISSED', 'ALL'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setStatusFilter(f)}
            className={`px-2.5 py-1 rounded ${
              statusFilter === f
                ? 'bg-brand-dark text-white'
                : 'bg-white border border-gray-200 text-brand-muted hover:bg-gray-50'
            }`}
          >
            {f === 'OPEN' ? 'Öppna' : f === 'ALL' ? 'Alla' : STATUS_META[f as Status].label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="py-16 text-center text-brand-muted">
          <Loader className="animate-spin mx-auto" size={24} />
          <div className="mt-2 text-sm">Laddar…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-gray-300 rounded-lg">
          <Heart className="mx-auto text-gray-300" size={40} />
          <div className="mt-3 text-sm text-brand-muted">Inga ärenden att visa.</div>
          <div className="mt-1 text-xs text-brand-muted">
            Kör en skanning för att hitta anställda med hög sjukfrånvaro senaste 12 månaderna.
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-brand-muted">
              <tr>
                <th className="px-4 py-3 text-left">Anställd</th>
                <th className="px-4 py-3 text-center">Tillfällen</th>
                <th className="px-4 py-3 text-center">Dagar</th>
                <th className="px-4 py-3 text-left">Trigger</th>
                <th className="px-4 py-3 text-left">Status</th>
                <th className="px-4 py-3 text-left">Uppdaterad</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c) => (
                <tr key={c.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-brand-dark">{c.employeeName}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{c.episodesCount}</td>
                  <td className="px-4 py-3 text-center tabular-nums">{c.daysCount}</td>
                  <td className="px-4 py-3">
                    <TriggerBadge trigger={c.metadata?.triggeredThreshold ?? null} />
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="px-4 py-3 text-xs text-brand-muted tabular-nums">
                    {new Date(c.updatedAt).toLocaleDateString('sv-SE')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => setSelectedId(c.id)}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-brand-dark hover:bg-gray-100"
                    >
                      Öppna
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selectedId != null && (
        <CaseDrawer id={selectedId} onClose={() => setSelectedId(null)} onChanged={load} />
      )}
    </div>
  );
}

// ─── DRAWER ────────────────────────────────────────────────────────────
function CaseDrawer({ id, onClose, onChanged }: { id: number; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<{ case: Case; events: any[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [previewEmail, setPreviewEmail] = useState<'email1' | 'email2' | null>(null);
  const [preview, setPreview] = useState<any>(null);

  useEffect(() => {
    (async () => {
      const r = await api<{ case: Case & { events: any[] } }>(`/api/hr/sick-leave/cases/${id}`);
      setData({ case: r.case, events: r.case.events || [] });
      setNotes(r.case.notes || '');
    })();
  }, [id]);

  const patch = async (body: any) => {
    setSaving(true);
    try {
      const r = await api<{ case: Case }>(`/api/hr/sick-leave/cases/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      setData((d) => (d ? { ...d, case: r.case as any } : d));
      onChanged();
    } finally {
      setSaving(false);
    }
  };

  const dismiss = async () => {
    const reason = prompt('Anledning till avfärdande (loggas):');
    if (reason === null) return;
    await patch({ status: 'DISMISSED', dismissReason: reason });
    onClose();
  };

  const openPreview = async (which: 'email1' | 'email2') => {
    setPreviewEmail(which);
    setPreview(null);
    const r = await api<any>(`/api/hr/sick-leave/cases/${id}/email-preview?which=${which}`);
    setPreview(r);
  };

  if (!data) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1 bg-black/30" onClick={onClose} />
        <div className="w-full max-w-2xl bg-white shadow-xl p-8 flex items-center justify-center">
          <Loader className="animate-spin text-brand-muted" size={24} />
        </div>
      </div>
    );
  }

  const c = data.case;

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-lg font-semibold text-brand-dark">{c.employeeName}</div>
            <div className="mt-1"><StatusBadge status={c.status} /></div>
          </div>
          <button onClick={onClose} className="text-brand-muted hover:text-brand-dark">
            <X size={20} />
          </button>
        </div>

        <div className="px-6 py-6 space-y-6">
          {/* Fakta */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-brand-muted">Tillfällen</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-brand-dark">{c.episodesCount}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-brand-muted">Dagar totalt</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-brand-dark">{c.daysCount}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-brand-muted">Fönster</div>
              <div className="mt-1 text-xs text-brand-muted">
                {new Date(c.windowStartDate).toLocaleDateString('sv-SE')} →{' '}
                {new Date(c.windowEndDate).toLocaleDateString('sv-SE')}
              </div>
            </div>
          </div>

          {/* Mall-förhandsvisning */}
          <div>
            <div className="text-xs uppercase tracking-wide text-brand-muted mb-2">Mallar (förhandsvisning)</div>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => openPreview('email1')}
                className="text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-brand-dark hover:bg-gray-50"
              >
                <div className="text-sm font-medium text-brand-dark">1. Omtankesmejl</div>
                <div className="text-xs text-brand-muted mt-0.5">Vänlig fråga, ingen diagnos</div>
              </button>
              <button
                onClick={() => openPreview('email2')}
                className="text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-brand-dark hover:bg-gray-50"
              >
                <div className="text-sm font-medium text-brand-dark">2. Beslut om förstadagsintyg</div>
                <div className="text-xs text-brand-muted mt-0.5">Formellt · efter möte</div>
              </button>
            </div>
            <p className="mt-2 text-[11px] text-brand-muted">
              Fas 1 — mallarna visas för läsning. Sändning aktiveras i Fas 2 efter arbetsrättsjuristgranskning.
            </p>
          </div>

          {previewEmail && (
            <div className="border border-gray-200 rounded-lg bg-gray-50">
              <div className="px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                <div className="text-xs uppercase tracking-wide text-brand-muted">
                  {previewEmail === 'email1' ? 'Omtankesmejl' : 'Beslut om förstadagsintyg'}
                </div>
                <button onClick={() => setPreviewEmail(null)} className="text-brand-muted hover:text-brand-dark">
                  <X size={14} />
                </button>
              </div>
              {!preview ? (
                <div className="p-4 text-sm text-brand-muted">Laddar…</div>
              ) : (
                <div className="p-4 space-y-2 text-sm">
                  <div><span className="text-[10px] uppercase tracking-wide text-brand-muted">Ämne</span><br />{preview.subject}</div>
                  <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-brand-dark bg-white p-3 rounded border border-gray-200">
{preview.body}
                  </pre>
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    <strong>Obs:</strong> {preview.disclaimer}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Anteckningar */}
          <div>
            <label className="text-xs uppercase tracking-wide text-brand-muted">Anteckningar (HR)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="mt-1 w-full border border-gray-200 rounded p-2 text-sm"
              placeholder="Fri anteckning — dokumentera samtal, mötesbeslut, mm."
            />
            <button
              onClick={() => patch({ notes })}
              disabled={saving}
              className="mt-2 text-xs px-3 py-1.5 rounded bg-brand-dark text-white hover:bg-brand-dark/90 disabled:opacity-50"
            >
              Spara anteckning
            </button>
          </div>

          {/* Status-knappar */}
          <div>
            <div className="text-xs uppercase tracking-wide text-brand-muted mb-2">Ändra status</div>
            <div className="flex flex-wrap gap-2">
              {(['UNDER_REVIEW', 'EMAIL1_DRAFTED', 'EMAIL1_SENT', 'MEETING_SCHEDULED', 'MEETING_HELD', 'RESOLVED'] as Status[]).map((s) => (
                <button
                  key={s}
                  onClick={() => patch({ status: s })}
                  disabled={saving || c.status === s}
                  className={`text-xs px-2.5 py-1 rounded border ${
                    c.status === s
                      ? 'border-brand-dark bg-brand-dark text-white'
                      : 'border-gray-200 text-brand-dark hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
              <button
                onClick={dismiss}
                disabled={saving}
                className="text-xs px-2.5 py-1 rounded border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              >
                Avfärda ärende
              </button>
            </div>
          </div>

          {/* Historik */}
          <div>
            <div className="text-xs uppercase tracking-wide text-brand-muted mb-2">Historik</div>
            <ol className="space-y-1.5">
              {data.events.map((e: any) => (
                <li key={e.id} className="text-xs text-brand-muted flex items-baseline gap-2">
                  <span className="tabular-nums">{new Date(e.createdAt).toLocaleString('sv-SE')}</span>
                  <span className="text-brand-dark font-medium">{e.action}</span>
                  {e.metadata && (
                    <span className="text-[11px] text-brand-muted">{JSON.stringify(e.metadata)}</span>
                  )}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
