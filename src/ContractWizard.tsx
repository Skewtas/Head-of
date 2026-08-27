/**
 * 4-stegs wizard för att skapa ett nytt anställningsavtal från mall.
 *
 * Steg 1 — Motpart + anställningsdata
 * Steg 2 — Välj mall
 * Steg 3 — Förhandsgranska (server-side substitution)
 * Steg 4 — Signerare + spara (signering kommer i Fas 4)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader, ChevronLeft, ChevronRight, Check, FileText } from 'lucide-react';
import { api } from './lib/api';

type Template = {
  id: number;
  name: string;
  category: string;
  ownCompanyId: number | null;
  ownCompany?: { name: string } | null;
};

type Company = { id: number; name: string };

export default function ContractWizard({
  companies,
  onClose,
  onDone,
}: {
  companies: Company[];
  onClose: () => void;
  onDone: (contractId: number) => void;
}) {
  const [step, setStep] = useState(0);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Steg 1 — data
  const [ownCompanyId, setOwnCompanyId] = useState<number>(companies[0]?.id ?? 0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [personalNumber, setPersonalNumber] = useState('');
  const [personEmail, setPersonEmail] = useState('');
  const [personPhone, setPersonPhone] = useState('');
  const [personAddress, setPersonAddress] = useState('');
  const [personZip, setPersonZip] = useState('');
  const [personCity, setPersonCity] = useState('');

  const [role, setRole] = useState('');
  const [occupationPct, setOccupationPct] = useState('100');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [probationEndDate, setProbationEndDate] = useState('');
  const [salary, setSalary] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [workHours, setWorkHours] = useState('Enligt schema, i genomsnitt 40 timmar per helgfri vecka.');
  const [vacation, setVacation] = useState('25 dagar per år enligt semesterlagen.');
  const [noticePeriod, setNoticePeriod] = useState('Enligt LAS.');
  const [collectiveAgreement, setCollectiveAgreement] = useState('Kollektivavtal Almega Serviceföretagen/Fastighets.');
  const [otherTerms, setOtherTerms] = useState('');

  // Steg 2 — mall
  const [templateId, setTemplateId] = useState<number | null>(null);

  // Steg 3 — preview
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [title, setTitle] = useState('');

  useEffect(() => {
    api<Template[]>('/api/contracts/templates').then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  const employmentCtx = useMemo(() => ({
    role, occupationPct, startDate, endDate, probationEndDate,
    salary, hourlyRate, workplace, workHours, vacation, noticePeriod,
    collectiveAgreement, otherTerms,
  }), [role, occupationPct, startDate, endDate, probationEndDate, salary, hourlyRate, workplace, workHours, vacation, noticePeriod, collectiveAgreement, otherTerms]);

  const personCtx = useMemo(() => ({
    firstName, lastName, personalNumber,
    email: personEmail, phone: personPhone,
    address: personAddress, postalCode: personZip, city: personCity,
  }), [firstName, lastName, personalNumber, personEmail, personPhone, personAddress, personZip, personCity]);

  // När vi går in på Preview-steget → hämta HTML från servern
  useEffect(() => {
    if (step !== 2 || !templateId || !ownCompanyId) return;
    setPreviewLoading(true);
    api<{ content: string; templateName: string }>('/api/contracts/preview-template', {
      method: 'POST',
      body: JSON.stringify({
        templateId,
        ownCompanyId,
        person: personCtx,
        employment: employmentCtx,
      }),
    })
      .then((d) => {
        setPreviewHtml(d.content);
        if (!title) setTitle(`${d.templateName} — ${firstName} ${lastName}`.trim());
      })
      .catch((e) => setErr(e?.message ?? String(e)))
      .finally(() => setPreviewLoading(false));
  }, [step, templateId, ownCompanyId, personCtx, employmentCtx]);

  const validateStep1 = () => {
    if (!firstName || !lastName || !role || !startDate) return 'Fyll i förnamn, efternamn, befattning och startdatum.';
    if (!ownCompanyId) return 'Välj företag.';
    return null;
  };

  const submit = async () => {
    if (!templateId) { setErr('Välj en mall först.'); return; }
    setSaving(true); setErr(null);
    try {
      const { contract } = await api<{ contract: { id: number } }>('/api/contracts/from-template', {
        method: 'POST',
        body: JSON.stringify({
          templateId,
          title: title || undefined,
          ownCompanyId,
          person: personCtx,
          employment: employmentCtx,
          startDate: startDate || null,
          endDate: endDate || null,
          probationEndDate: probationEndDate || null,
        }),
      });
      onDone(contract.id);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-4xl w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-brand-accent" />
            <h3 className="text-lg font-serif text-brand-dark">Nytt anställningsavtal</h3>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-brand-dark"><X className="w-5 h-5" /></button>
        </div>

        {/* Progress-steps */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 bg-gray-50">
          {['Motpart & villkor', 'Välj mall', 'Förhandsgranska', 'Signerare'].map((label, i) => (
            <div key={label} className="flex items-center gap-2 flex-1">
              <div
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold ${
                  i < step ? 'bg-emerald-500 text-white' : i === step ? 'bg-brand-dark text-white' : 'bg-gray-200 text-gray-500'
                }`}
              >
                {i < step ? <Check className="w-3 h-3" /> : i + 1}
              </div>
              <span className={`text-xs ${i === step ? 'font-bold text-brand-dark' : 'text-brand-muted'}`}>{label}</span>
              {i < 3 && <div className="flex-1 h-px bg-gray-200" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 0 && (
            <div className="space-y-6">
              <section>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-3">Företag (arbetsgivare)</h4>
                <select value={ownCompanyId} onChange={(e) => setOwnCompanyId(Number(e.target.value))} className={inp}>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </section>

              <section>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-3">Motpart (anställd)</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Förnamn *"><input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={inp} /></Field>
                  <Field label="Efternamn *"><input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inp} /></Field>
                  <Field label="Personnummer"><input value={personalNumber} onChange={(e) => setPersonalNumber(e.target.value)} placeholder="ÅÅÅÅMMDD-XXXX" className={inp} /></Field>
                  <Field label="E-post"><input value={personEmail} onChange={(e) => setPersonEmail(e.target.value)} className={inp} type="email" /></Field>
                  <Field label="Telefon"><input value={personPhone} onChange={(e) => setPersonPhone(e.target.value)} className={inp} /></Field>
                  <div />
                  <Field label="Adress"><input value={personAddress} onChange={(e) => setPersonAddress(e.target.value)} className={inp} /></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Postnr"><input value={personZip} onChange={(e) => setPersonZip(e.target.value)} className={inp} /></Field>
                    <Field label="Ort"><input value={personCity} onChange={(e) => setPersonCity(e.target.value)} className={inp} /></Field>
                  </div>
                </div>
              </section>

              <section>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-3">Anställningsvillkor</h4>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Befattning *"><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Städare, Teamledare…" className={inp} /></Field>
                  <Field label="Anställningsgrad (%)"><input value={occupationPct} onChange={(e) => setOccupationPct(e.target.value)} type="number" className={inp} /></Field>
                  <Field label="Tillträdesdag *"><input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inp} /></Field>
                  <Field label="Slutdatum (visstid)"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inp} /></Field>
                  <Field label="Provanställning t.o.m."><input type="date" value={probationEndDate} onChange={(e) => setProbationEndDate(e.target.value)} className={inp} /></Field>
                  <Field label="Arbetsplats"><input value={workplace} onChange={(e) => setWorkplace(e.target.value)} placeholder="Stockholm, hemadress etc." className={inp} /></Field>
                  <Field label="Månadslön (kr)"><input value={salary} onChange={(e) => setSalary(e.target.value)} type="number" className={inp} /></Field>
                  <Field label="Timlön (kr)"><input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} type="number" className={inp} /></Field>
                </div>
                <Field label="Arbetstid"><input value={workHours} onChange={(e) => setWorkHours(e.target.value)} className={inp} /></Field>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <Field label="Semester"><input value={vacation} onChange={(e) => setVacation(e.target.value)} className={inp} /></Field>
                  <Field label="Uppsägningstid"><input value={noticePeriod} onChange={(e) => setNoticePeriod(e.target.value)} className={inp} /></Field>
                </div>
                <Field label="Kollektivavtal"><input value={collectiveAgreement} onChange={(e) => setCollectiveAgreement(e.target.value)} className={inp} /></Field>
                <Field label="Övriga villkor"><textarea value={otherTerms} onChange={(e) => setOtherTerms(e.target.value)} rows={3} className={`${inp} resize-none`} /></Field>
              </section>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-3">
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Välj mall</h4>
              {templates.length === 0 ? (
                <p className="text-sm text-brand-muted italic">Inga mallar. Kör migrationen med seed så finns tillsvidare / prov / visstid / tim.</p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {templates.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setTemplateId(t.id)}
                      className={`text-left border rounded-xl p-4 transition ${
                        templateId === t.id ? 'border-brand-accent bg-brand-accent/5 shadow-sm' : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}
                    >
                      <div className="font-semibold text-brand-dark text-sm">{t.name}</div>
                      <div className="text-xs text-brand-muted mt-1">{t.category}</div>
                      {t.ownCompany && <div className="text-[11px] text-brand-muted mt-2">{t.ownCompany.name}</div>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="space-y-3">
              <Field label="Titel (visas i listan)">
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={inp} />
              </Field>
              <h4 className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mt-4">Förhandsgranska avtalet</h4>
              <div className="border border-gray-200 rounded-xl bg-white p-6 max-h-[50vh] overflow-y-auto text-sm text-brand-dark leading-relaxed">
                {previewLoading ? (
                  <div className="text-center py-8"><Loader className="w-5 h-5 animate-spin mx-auto text-brand-accent" /></div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                )}
              </div>
              <p className="text-[11px] text-brand-muted italic">
                Manuella redigeringar av innehållet kommer i version 2 av wizarden — ändra värden ovan (steg 1) om något är fel.
              </p>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3">
              <div className="border border-emerald-100 bg-emerald-50/40 rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <Check className="w-4 h-4 text-emerald-700 mt-0.5" />
                  <div>
                    <div className="text-sm font-semibold text-emerald-900">Redo att sparas som utkast</div>
                    <div className="text-xs text-emerald-700 mt-1">
                      Signeringsflödet (Visma Sign) kopplas på i Fas 4. Just nu sparas avtalet som DRAFT — du kan sen skicka det för signering när Fas 4 är på plats.
                    </div>
                  </div>
                </div>
              </div>

              <div className="text-sm text-brand-muted">
                <p><strong className="text-brand-dark">Signerare</strong> (planerade — läggs till skarpt i Fas 4):</p>
                <ol className="list-decimal ml-5 mt-2 space-y-1">
                  <li>{firstName} {lastName} — anställd</li>
                  <li>{companies.find((c) => c.id === ownCompanyId)?.name} — firmatecknare</li>
                </ol>
              </div>
            </div>
          )}

          {err && (
            <div className="mt-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{err}</div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center gap-3">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="flex items-center gap-1 px-3 py-2 text-sm font-semibold text-brand-muted hover:text-brand-dark disabled:opacity-40"
          >
            <ChevronLeft className="w-4 h-4" /> Tillbaka
          </button>

          {step < 3 ? (
            <button
              onClick={() => {
                if (step === 0) {
                  const e = validateStep1();
                  if (e) { setErr(e); return; }
                }
                if (step === 1 && !templateId) { setErr('Välj en mall.'); return; }
                setErr(null);
                setStep((s) => s + 1);
              }}
              className="flex items-center gap-1 px-5 py-2 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-accent"
            >
              Nästa <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-accent disabled:opacity-50"
            >
              {saving && <Loader className="w-4 h-4 animate-spin" />} Spara som utkast
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const inp = 'w-full px-3 py-2 border border-gray-200 rounded-lg outline-none focus:border-brand-accent text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-1">{label}</label>
      {children}
    </div>
  );
}
