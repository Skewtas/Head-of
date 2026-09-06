/**
 * HR — Sjukfrånvaro-uppföljning (Fas 1).
 *
 * Läsvy + trigger av manuell skanning. Inga mail skickas i denna fas —
 * "Öppna mall" visar innehållet i ett förhandsgranskningspanel.
 */
import { useEffect, useMemo, useState } from 'react';
import { Heart, RefreshCw, AlertTriangle, Loader, X, ShieldAlert, MessageCircle, FileCheck, Eye, Languages, Send, History } from 'lucide-react';
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
  intygStartDate: string | null;
  intygEndDate: string | null;
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

type SummaryRow = {
  timewaveEmployeeId: number;
  name: string;
  email: string | null;
  episodes: number;
  days: number;
  latest: string;
  triggeredThreshold: 'STRONG' | 'WARNING' | 'DAYS' | null;
  byMonth: Record<string, number>;
};

type MonthlyTotals = Record<string, { totalDays: number; employees: number }>;

export default function HRView() {
  const [cases, setCases] = useState<Case[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [months, setMonths] = useState<string[]>([]);
  const [monthlyTotals, setMonthlyTotals] = useState<MonthlyTotals>({});
  const [windowLabel, setWindowLabel] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedEmp, setSelectedEmp] = useState<{ empId: number; name: string; caseId: number | null } | null>(null);
  const [filter, setFilter] = useState<'FLAGGED' | 'ALL' | 'CASES'>('FLAGGED');
  const [accessDenied, setAccessDenied] = useState(false);

  const fetchAll = async () => {
    try {
      const [scan, list] = await Promise.all([
        api<any>('/api/hr/sick-leave/scan', { method: 'POST', body: '{}' }),
        api<{ cases: Case[] }>('/api/hr/sick-leave/cases'),
      ]);
      setSummary(scan.summary || []);
      setMonths(scan.months || []);
      setMonthlyTotals(scan.monthlyTotals || {});
      setWindowLabel(`${scan.windowStart} → ${scan.windowEnd}`);
      setCases(list.cases || []);
    } catch (e: any) {
      if (e?.status === 403) setAccessDenied(true);
      else console.error('HR fetch failed', e);
    }
  };

  useEffect(() => {
    (async () => {
      setLoading(true);
      await fetchAll();
      setLoading(false);
    })();
  }, []);

  const refresh = async () => {
    if (refreshing) return;
    setRefreshing(true);
    await fetchAll();
    setRefreshing(false);
  };

  // Map anställd → case (om finns)
  const caseByEmp = useMemo(() => {
    const m = new Map<number, Case>();
    for (const c of cases) m.set(c.timewaveEmployeeId, c);
    return m;
  }, [cases]);

  const rows = useMemo(() => {
    let filtered = summary;
    if (filter === 'FLAGGED') filtered = summary.filter((s) => s.triggeredThreshold);
    else if (filter === 'CASES') filtered = summary.filter((s) => caseByEmp.has(s.timewaveEmployeeId));
    return filtered.sort((a, b) => b.episodes - a.episodes || b.days - a.days);
  }, [summary, filter, caseByEmp]);

  if (accessDenied) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <ShieldAlert className="mx-auto text-rose-400" size={48} />
        <h1 className="mt-4 text-xl font-semibold text-brand-dark">HR-modul — åtkomst nekad</h1>
        <p className="mt-2 text-sm text-brand-muted">
          Sjukfrånvaro är känsligt och begränsat till HR-behöriga. Kontakta systemadministratör
          för att lägga till din e-postadress i <code className="bg-gray-100 px-1 rounded">HR_ADMIN_EMAILS</code>.
        </p>
        <button
          onClick={async () => {
            try {
              const r = await api<any>('/api/hr/whoami');
              alert(JSON.stringify(r, null, 2));
            } catch (e: any) {
              alert('Whoami misslyckades: ' + (e?.message || e));
            }
          }}
          className="mt-6 text-xs px-3 py-1.5 rounded border border-gray-300 text-brand-muted hover:bg-gray-50"
        >
          Debug — vad ser servern om mig?
        </button>
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
            Sjukfrånvaro senaste 12 månaderna, hämtat live från Timewave.
            Alla mail granskas manuellt av HR — inga automatiska utskick. Frågar aldrig om diagnos.
          </p>
          {windowLabel && (
            <div className="mt-1 text-[11px] text-brand-muted tabular-nums">
              Fönster: {windowLabel}
            </div>
          )}
        </div>
        <button
          onClick={refresh}
          disabled={refreshing || loading}
          className="inline-flex items-center gap-2 px-3 py-1.5 rounded border border-gray-200 text-brand-muted hover:bg-gray-50 text-xs disabled:opacity-50"
          title="Hämta senaste från Timewave igen"
        >
          {refreshing ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Uppdatera
        </button>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-2 mb-4 text-xs">
        {(
          [
            { k: 'FLAGGED', label: `Över tröskel (${summary.filter((s) => s.triggeredThreshold).length})` },
            { k: 'CASES', label: `Öppna ärenden (${cases.filter((c) => c.status !== 'RESOLVED' && c.status !== 'DISMISSED').length})` },
            { k: 'ALL', label: `Alla med frånvaro (${summary.length})` },
          ] as const
        ).map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`px-2.5 py-1 rounded ${
              filter === f.k
                ? 'bg-brand-dark text-white'
                : 'bg-white border border-gray-200 text-brand-muted hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      {loading ? (
        <div className="py-16 text-center text-brand-muted">
          <Loader className="animate-spin mx-auto" size={24} />
          <div className="mt-2 text-sm">Hämtar från Timewave…</div>
          <div className="mt-1 text-[11px] text-brand-muted">Kan ta 10-30 sekunder första gången.</div>
        </div>
      ) : rows.length === 0 ? (
        <div className="py-16 text-center border border-dashed border-gray-300 rounded-lg">
          <Heart className="mx-auto text-gray-300" size={40} />
          <div className="mt-3 text-sm text-brand-muted">
            {filter === 'FLAGGED' && 'Ingen anställd över tröskel just nu. 🎉'}
            {filter === 'CASES' && 'Inga öppna ärenden.'}
            {filter === 'ALL' && 'Ingen registrerad sjukfrånvaro senaste 12 månaderna.'}
          </div>
        </div>
      ) : (
        <>
          {/* Månadsöversikt — totalt sjukdagar + antal anställda per månad */}
          {months.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-lg mb-4 overflow-hidden">
              <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 text-xs font-semibold text-brand-muted uppercase tracking-wide">
                Månad för månad
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}>
                {months.map((m) => {
                  const label = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' }).format(new Date(m + '-01'));
                  const t = monthlyTotals[m] || { totalDays: 0, employees: 0 };
                  return (
                    <div key={m} className="p-4 border-r border-gray-100 last:border-r-0">
                      <div className="text-[10px] text-brand-muted uppercase tracking-wide capitalize">{label}</div>
                      <div className="text-2xl font-semibold text-brand-dark tabular-nums mt-1">{t.totalDays}</div>
                      <div className="text-[11px] text-brand-muted">sjukdagar · {t.employees} pers</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs uppercase tracking-wide text-brand-muted">
              <tr>
                <th className="px-4 py-3 text-left">Anställd</th>
                <th className="px-3 py-3 text-center">Tillf.</th>
                <th className="px-3 py-3 text-center">Dagar</th>
                {months.map((m) => (
                  <th key={m} className="px-2 py-3 text-center text-[10px]">
                    {new Intl.DateTimeFormat('sv-SE', { month: 'short', timeZone: 'Europe/Stockholm' }).format(new Date(m + '-01'))}
                  </th>
                ))}
                <th className="px-3 py-3 text-left">Trigger</th>
                <th className="px-3 py-3 text-left">Ärende</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const c = caseByEmp.get(s.timewaveEmployeeId);
                return (
                <tr key={s.timewaveEmployeeId} className="border-t border-gray-100 hover:bg-gray-50/50">
                  <td className="px-4 py-3 font-medium text-brand-dark">{s.name}</td>
                  <td className="px-3 py-3 text-center tabular-nums">{s.episodes}</td>
                  <td className="px-3 py-3 text-center tabular-nums font-semibold">{s.days}</td>
                  {months.map((m) => {
                    const d = s.byMonth?.[m] ?? 0;
                    return (
                      <td key={m} className={`px-2 py-3 text-center text-xs tabular-nums ${d === 0 ? 'text-gray-300' : 'text-brand-dark'}`}>
                        {d || '·'}
                      </td>
                    );
                  })}
                  <td className="px-3 py-3"><TriggerBadge trigger={s.triggeredThreshold} /></td>
                  <td className="px-3 py-3">
                    {c ? <StatusBadge status={c.status} /> : <span className="text-[11px] text-brand-muted">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      onClick={() => setSelectedEmp({ empId: s.timewaveEmployeeId, name: s.name, caseId: c?.id ?? null })}
                      className="text-xs px-2 py-1 rounded border border-gray-200 text-brand-dark hover:bg-gray-100"
                    >
                      Öppna
                    </button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}

      {selectedEmp && (
        <CaseDrawer
          empId={selectedEmp.empId}
          empName={selectedEmp.name}
          caseId={selectedEmp.caseId}
          onClose={() => setSelectedEmp(null)}
          onChanged={refresh}
        />
      )}
    </div>
  );
}

// ─── DRAWER ────────────────────────────────────────────────────────────
function CaseDrawer({
  empId,
  empName,
  caseId,
  onClose,
  onChanged,
}: {
  empId: number;
  empName: string;
  caseId: number | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [id, setId] = useState<number | null>(caseId);
  const [data, setData] = useState<{ case: Case; events: any[] } | null>(null);
  const [saving, setSaving] = useState(false);
  const [notes, setNotes] = useState('');
  const [previewEmail, setPreviewEmail] = useState<'email1' | 'email2' | null>(null);
  const [preview, setPreview] = useState<any>(null);
  const [previewLang, setPreviewLang] = useState<string>('sv');
  const [translatedSubject, setTranslatedSubject] = useState<string>('');
  const [translatedBody, setTranslatedBody] = useState<string>('');
  const [translating, setTranslating] = useState(false);
  const [recipientRaw, setRecipientRaw] = useState<string>('');
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; sent: string[]; failed: { email: string; error: string }[] } | null>(null);
  const [intygMonths, setIntygMonths] = useState<number>(6);
  const [history, setHistory] = useState<{ previous: any[]; intygCount: number } | null>(null);

  useEffect(() => {
    if (id == null) return;
    (async () => {
      const r = await api<{ case: Case & { events: any[] } }>(`/api/hr/sick-leave/cases/${id}`);
      setData({ case: r.case, events: r.case.events || [] });
      setNotes(r.case.notes || '');
      try {
        const h = await api<{ previous: any[]; intygCount: number }>(`/api/hr/sick-leave/cases/${id}/history`);
        setHistory(h);
      } catch { /* icke-kritiskt */ }
    })();
  }, [id]);

  const patch = async (body: any) => {
    if (id == null) return;
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
    setPreviewLang('sv');
    setTranslatedSubject('');
    setTranslatedBody('');
    setSendResult(null);
    const r = await api<any>(`/api/hr/sick-leave/cases/${id}/email-preview?which=${which}`);
    setPreview(r);
  };

  const translatePreview = async (lang: string) => {
    if (!preview || lang === 'sv') {
      setPreviewLang('sv');
      setTranslatedSubject('');
      setTranslatedBody('');
      return;
    }
    setTranslating(true);
    setPreviewLang(lang);
    try {
      const [subjRes, bodyRes] = await Promise.all([
        api<{ translated: string }>('/api/personalbrev-translate', {
          method: 'POST',
          body: JSON.stringify({ text: preview.subject, targetLanguage: lang }),
        }),
        api<{ translated: string }>('/api/personalbrev-translate', {
          method: 'POST',
          body: JSON.stringify({ text: preview.body, targetLanguage: lang }),
        }),
      ]);
      setTranslatedSubject(subjRes.translated || '');
      setTranslatedBody(bodyRes.translated || '');
    } finally {
      setTranslating(false);
    }
  };

  const sendEmail = async () => {
    if (!preview || !previewEmail || id == null) return;
    const toList = recipientRaw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (toList.length === 0) {
      alert('Fyll i minst en mottagares e-post.');
      return;
    }
    if (!toList.every((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) {
      alert('Kontrollera e-postadresserna — någon verkar felaktig.');
      return;
    }
    const finalSubject = translatedSubject || preview.subject;
    const finalBody = translatedBody || preview.body;
    if (
      !confirm(
        `Skickar ${previewEmail === 'email1' ? 'omtankesmejl' : 'BESLUT om förstadagsintyg'} till:\n\n${toList.join(', ')}\n\nÄmne: ${finalSubject}\n\nFortsätt?`,
      )
    )
      return;
    setSending(true);
    setSendResult(null);
    try {
      const r = await api<{ ok: boolean; sent: string[]; failed: any[]; newStatus?: string }>(
        `/api/hr/sick-leave/cases/${id}/send-email`,
        {
          method: 'POST',
          body: JSON.stringify({
            which: previewEmail,
            to: toList,
            subject: finalSubject,
            bodyText: finalBody,
            language: previewLang,
            ...(previewEmail === 'email2' ? { intygPeriodMonths: intygMonths } : {}),
          }),
        },
      );
      setSendResult(r);
      if (r.ok) {
        // Uppdatera vyn så statusen syns
        const c = await api<{ case: Case & { events: any[] } }>(`/api/hr/sick-leave/cases/${id}`);
        setData({ case: c.case, events: c.case.events || [] });
        onChanged();
      }
    } catch (e: any) {
      setSendResult({ ok: false, sent: [], failed: [{ email: '(nätverk)', error: e?.body?.error || e?.message || 'okänt fel' }] });
    } finally {
      setSending(false);
    }
  };

  // Ingen case-rad ännu — visa "skapa"-vy
  if (id == null) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="flex-1 bg-black/30" onClick={onClose} />
        <div className="w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
            <div className="text-lg font-semibold text-brand-dark">{empName}</div>
            <button onClick={onClose} className="text-brand-muted hover:text-brand-dark"><X size={20} /></button>
          </div>
          <div className="p-8 text-center">
            <Heart className="mx-auto text-gray-300" size={40} />
            <p className="mt-4 text-sm text-brand-muted">
              Inget ärende registrerat för denna anställd ännu.<br />
              Skapa ett ärende för att börja dokumentera HR-uppföljningen (anteckningar, samtal, beslut).
            </p>
            <button
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                try {
                  const r = await api<any>('/api/hr/sick-leave/cases', {
                    method: 'POST',
                    body: JSON.stringify({ timewaveEmployeeId: empId, employeeName: empName }),
                  });
                  setId(r.case.id);
                  onChanged();
                } finally {
                  setSaving(false);
                }
              }}
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-dark text-white text-sm font-medium hover:bg-brand-dark/90 disabled:opacity-50"
            >
              {saving ? <Loader size={14} className="animate-spin" /> : null}
              Skapa ärende för {empName.split(' ')[0]}
            </button>
          </div>
        </div>
      </div>
    );
  }

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
          {/* Historik-notis */}
          {history && history.intygCount > 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-orange-200 bg-orange-50 text-xs text-orange-900">
              <History size={14} className="mt-0.5" />
              <div>
                <strong>{history.intygCount}</strong> tidigare beslut om förstadagsintyg för denna anställd.
                {' '}Väg in det när du fattar nytt beslut.
              </div>
            </div>
          )}
          {history && history.previous.length > 0 && history.intygCount === 0 && (
            <div className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 bg-gray-50 text-xs text-brand-muted">
              <History size={14} className="mt-0.5" />
              <div>
                {history.previous.length} tidigare HR-ärende{history.previous.length === 1 ? '' : 'n'} (utan förstadagsintyg-beslut).
              </div>
            </div>
          )}

          {/* Aktivt förstadagsintyg */}
          {c.status === 'EMAIL2_SENT' && (c as any).intygEndDate && (
            <div className="p-3 rounded-lg border border-orange-300 bg-orange-100 text-xs text-orange-900">
              <strong>Förstadagsintyg aktivt</strong> — kräv läkarintyg från dag 1.
              {' '}Gäller till <strong>{new Date((c as any).intygEndDate).toLocaleDateString('sv-SE')}</strong>.
            </div>
          )}

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
              Öppna en mall → välj språk → fyll i mottagare → skicka. BCC:as alltid till info@stodona.se.
              {' '}Beslutsmejlet aktiverar automatiskt förstadagsintyg i angiven period.
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
                <div className="p-4 space-y-3 text-sm">
                  {/* Språkval */}
                  <div className="flex items-center gap-2 text-xs">
                    <Languages size={14} className="text-brand-muted" />
                    <span className="text-brand-muted">Språk:</span>
                    <select
                      value={previewLang}
                      onChange={(e) => translatePreview(e.target.value)}
                      disabled={translating}
                      className="border border-gray-200 rounded px-2 py-1 text-xs"
                    >
                      <option value="sv">Svenska (original)</option>
                      <option value="en">English</option>
                      <option value="uk">Українська</option>
                      <option value="es">Español</option>
                      <option value="sq">Shqip</option>
                      <option value="pl">Polski</option>
                      <option value="ar">العربية</option>
                      <option value="ru">Русский</option>
                      <option value="ro">Română</option>
                    </select>
                    {translating && <Loader size={12} className="animate-spin text-brand-muted" />}
                  </div>

                  <div>
                    <span className="text-[10px] uppercase tracking-wide text-brand-muted">Ämne</span>
                    <br />
                    {translatedSubject || preview.subject}
                  </div>
                  <pre className="whitespace-pre-wrap font-sans text-sm text-brand-dark bg-white p-3 rounded border border-gray-200">
{translatedBody || preview.body}
                  </pre>

                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded p-2">
                    <strong>Obs:</strong> {preview.disclaimer}
                  </p>

                  {/* Skicka */}
                  <div className="border-t border-gray-200 pt-3 space-y-2">
                    <label className="text-[10px] uppercase tracking-wide text-brand-muted">
                      Mottagare (kommaseparerade)
                    </label>
                    <input
                      type="text"
                      value={recipientRaw}
                      onChange={(e) => setRecipientRaw(e.target.value)}
                      placeholder="anställd@exempel.se, info@stodona.se"
                      className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
                    />
                    {previewEmail === 'email2' && (
                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-brand-muted">Förstadagsintyg gäller i:</span>
                        <select
                          value={intygMonths}
                          onChange={(e) => setIntygMonths(Number(e.target.value))}
                          className="border border-gray-200 rounded px-2 py-1 text-xs"
                        >
                          <option value={3}>3 månader</option>
                          <option value={6}>6 månader</option>
                          <option value={12}>12 månader</option>
                        </select>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={sendEmail}
                        disabled={sending || !recipientRaw.trim()}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white disabled:opacity-50 ${
                          previewEmail === 'email2' ? 'bg-orange-600 hover:bg-orange-700' : 'bg-brand-dark hover:bg-brand-dark/90'
                        }`}
                      >
                        {sending ? <Loader size={12} className="animate-spin" /> : <Send size={12} />}
                        {previewEmail === 'email1' ? 'Skicka omtankesmejl' : 'Skicka beslut om förstadagsintyg'}
                      </button>
                      <span className="text-[11px] text-brand-muted">
                        BCC info@stodona.se · via Resend
                      </span>
                    </div>
                    {sendResult && (
                      <div className={`mt-2 text-xs p-2 rounded border ${sendResult.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                        {sendResult.ok ? (
                          <>✓ Skickat till {sendResult.sent.join(', ')}</>
                        ) : (
                          <>
                            <div>✗ Misslyckades:</div>
                            {sendResult.failed.map((f, i) => (
                              <div key={i} className="mt-0.5">· {f.email}: {f.error}</div>
                            ))}
                          </>
                        )}
                      </div>
                    )}
                  </div>
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
