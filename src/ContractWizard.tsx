/**
 * 4-stegs wizard för att skapa ett nytt anställningsavtal från mall.
 *
 * Steg 1 — Motpart + anställningsdata
 * Steg 2 — Välj mall
 * Steg 3 — Förhandsgranska (server-side substitution)
 * Steg 4 — Signerare + spara (signering kommer i Fas 4)
 */
import React, { useEffect, useMemo, useState } from 'react';
import { X, Loader, ChevronLeft, ChevronRight, Check, FileText, UserSearch, Users } from 'lucide-react';
import { api } from './lib/api';

type TimewaveEmployee = {
  id: number;
  first_name?: string;
  last_name?: string;
  personal_number?: string;
  email?: string;
  mobile?: string;
  phone?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  employee_startdate?: string | null;
  base_contract?: {
    occupation?: number;
    job_title?: string;
    title?: string;
    position?: string;
    hourly_rate?: number | string;
    salary?: number | string;
  } | null;
  // Möjliga extra-fält Timewave kan skicka
  employee_number?: string;
  job_title?: string;
  title?: string;
  position?: string;
  role?: string;
  bank_account?: string;
  hourly_rate?: number | string;
  salary?: number | string;
  status?: string;
  deleted?: boolean;
};

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
  // Sysselsättningsgrad: "ON_DEMAND" (default), "25", "50", "75", "80", "100", "OTHER"
  const [occupationMode, setOccupationMode] = useState<'ON_DEMAND' | '25' | '50' | '75' | '80' | '100' | 'OTHER'>('ON_DEMAND');
  const [occupationOther, setOccupationOther] = useState('');
  // Serialiserad occupation för mall + validering — "Vid behov" eller "X %"
  const occupationPct = occupationMode === 'ON_DEMAND'
    ? 'Vid behov'
    : occupationMode === 'OTHER'
      ? (occupationOther || '')
      : occupationMode;
  const [employmentForm, setEmploymentForm] = useState<'TILLSVIDARE' | 'PROV' | 'VISSTID' | 'TIM'>('TIM');
  const [workArea, setWorkArea] = useState('Stockholm med omnejd');
  const [employmentNumber, setEmploymentNumber] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // Löneform: HOURLY (timlön) eller MONTHLY (månadslön). Default HOURLY.
  const [salaryForm, setSalaryForm] = useState<'HOURLY' | 'MONTHLY'>('HOURLY');
  // Semesterersättning ingår i timlönen (default TRUE per regel).
  const [vacationIncludedInHourly, setVacationIncludedInHourly] = useState(true);

  // Timanställning: MAX 1 år, slutdatum auto-räknas från tillträde (start + 1 år − 1 dag)
  const autoTimEnd = (isoStart: string): string => {
    if (!isoStart) return '';
    const d = new Date(isoStart);
    if (isNaN(d.getTime())) return '';
    d.setFullYear(d.getFullYear() + 1);
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  // Byter man till TIM efter man satt startdatum → fyll i slutdatum automatiskt
  useEffect(() => {
    if (employmentForm === 'TIM' && startDate && !endDate) {
      setEndDate(autoTimEnd(startDate));
    }
  }, [employmentForm, startDate, endDate]);
  const [probationEndDate, setProbationEndDate] = useState('');
  const [salary, setSalary] = useState('');
  const [hourlyRate, setHourlyRate] = useState('');
  const [workplace, setWorkplace] = useState('');
  const [workHours, setWorkHours] = useState('Enligt schema, i genomsnitt 40 timmar per helgfri vecka.');
  const [vacation, setVacation] = useState('25 dagar per år enligt semesterlagen.');
  const [noticePeriod, setNoticePeriod] = useState('Enligt LAS.');
  const [otherTerms, setOtherTerms] = useState('');

  // Steg 2 — mall
  const [templateId, setTemplateId] = useState<number | null>(null);

  // Steg 3 — preview
  const [previewHtml, setPreviewHtml] = useState<string>('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [title, setTitle] = useState('');

  // Timewave-anställda för autofyll av person
  const [twEmployees, setTwEmployees] = useState<TimewaveEmployee[]>([]);
  const [empSearch, setEmpSearch] = useState('');
  const [empSearchOpen, setEmpSearchOpen] = useState(false);
  const [twId, setTwId] = useState<number | null>(null);

  useEffect(() => {
    api<Template[]>('/api/contracts/templates').then(setTemplates).catch(() => setTemplates([]));
    // Timewave-listan är oftast ~40 anställda — hämta hela och filtrera lokalt
    fetch('/api/timewave/employees?page[size]=200')
      .then((r) => (r.ok ? r.json() : { data: [] }))
      .then((d: { data?: TimewaveEmployee[] }) => {
        setTwEmployees((d.data || []).filter((e) => !e.deleted && e.status === 'active'));
      })
      .catch(() => setTwEmployees([]));
  }, []);

  const filteredEmployees = useMemo(() => {
    if (!empSearch.trim()) return twEmployees.slice(0, 20);
    const q = empSearch.toLowerCase();
    return twEmployees
      .filter((e) => {
        const name = `${e.first_name || ''} ${e.last_name || ''}`.toLowerCase();
        const pnr = (e.personal_number || '').toLowerCase();
        return name.includes(q) || pnr.includes(q);
      })
      .slice(0, 20);
  }, [twEmployees, empSearch]);

  const pickTimewaveEmployee = (e: TimewaveEmployee) => {
    setTwId(e.id);
    setFirstName(e.first_name || '');
    setLastName(e.last_name || '');
    setPersonalNumber(e.personal_number || '');
    setPersonEmail(e.email || '');
    setPersonPhone(e.mobile || e.phone || '');
    setPersonAddress(e.address || '');
    setPersonZip(e.postal_code || '');
    setPersonCity(e.city || '');

    // Startdatum
    if (e.employee_startdate) setStartDate(String(e.employee_startdate).slice(0, 10));

    // Sysselsättningsgrad — försök mappa Timewave-värdet till våra alternativ.
    // Default förblir "Vid behov" om Timewave saknar värde.
    if (e.base_contract?.occupation) {
      const p = String(e.base_contract.occupation);
      if (['25','50','75','80','100'].includes(p)) setOccupationMode(p as any);
      else if (Number(p) > 0) { setOccupationMode('OTHER'); setOccupationOther(p); }
    }

    // Befattning — sök i alla möjliga fält Timewave kan använda.
    // Default till "Städare" (Stodona är städbolag) om ingen titel finns.
    const jobTitle =
      e.job_title || e.title || e.position || e.role ||
      e.base_contract?.job_title || e.base_contract?.title || e.base_contract?.position ||
      'Städare';
    setRole(jobTitle);

    // Anställningsnummer — MÅSTE vara Fortnox-numret exakt.
    // Vi auto-fyller ENDAST om Timewave råkar ha det redan. Ingen autogenerering.
    if (e.employee_number) {
      setEmploymentNumber(e.employee_number);
    }

    // Timlön/månadslön om Timewave har det
    const hr = e.hourly_rate ?? e.base_contract?.hourly_rate;
    if (hr && !hourlyRate) setHourlyRate(String(hr));
    const sal = e.salary ?? e.base_contract?.salary;
    if (sal && !salary) setSalary(String(sal));

    // Bankkonto
    if (e.bank_account && !bankAccount) setBankAccount(e.bank_account);

    setEmpSearchOpen(false);
    setEmpSearch(`${e.first_name || ''} ${e.last_name || ''}`.trim());
  };

  const selectedTemplate = templates.find((t) => t.id === templateId) || null;

  const employmentCtx = useMemo(() => ({
    // camelCase (för gamla mallar) + snake_case (för Stodona Standard-mallen)
    role, job_title: role,
    occupationPct, percentage: occupationPct,
    startDate, start_date: startDate,
    endDate, end_date: endDate,
    probationEndDate, probation_end_date: probationEndDate,
    // Löneform: skickar bara den som är vald
    salary_form: salaryForm,
    salaryForm,
    salary: salaryForm === 'MONTHLY' ? salary : '',
    hourlyRate: salaryForm === 'HOURLY' ? hourlyRate : '',
    hourly_rate: salaryForm === 'HOURLY' ? hourlyRate : '',
    vacation_included_in_hourly: salaryForm === 'HOURLY' ? vacationIncludedInHourly : null,
    vacationIncludedInHourly: salaryForm === 'HOURLY' ? vacationIncludedInHourly : null,
    workplace, work_area: workArea || workplace,
    workHours, vacation,
    noticePeriod, notice_period: noticePeriod,
    otherTerms,
    employment_form: employmentForm,
    employmentForm,
    employment_number: employmentNumber,
    employmentNumber,
    bank_account: bankAccount,
    bankAccount,
  }), [role, occupationPct, startDate, endDate, probationEndDate, salary, salaryForm, hourlyRate, vacationIncludedInHourly, workplace, workArea, workHours, vacation, noticePeriod, otherTerms, employmentForm, employmentNumber, bankAccount]);

  const personCtx = useMemo(() => ({
    firstName, lastName, personalNumber,
    email: personEmail, phone: personPhone,
    address: personAddress, postalCode: personZip, city: personCity,
    timewaveEmployeeId: twId,
  }), [firstName, lastName, personalNumber, personEmail, personPhone, personAddress, personZip, personCity, twId]);

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
    if (!firstName || !lastName || !startDate) {
      return 'Fyll i förnamn, efternamn och startdatum — eller välj anställd från Timewave för att hämta allt automatiskt.';
    }
    if (!role) return 'Befattning saknas. Välj anställd från Timewave, eller fyll i manuellt (t.ex. "Städare").';
    if (!ownCompanyId) return 'Välj arbetsgivare.';
    if (!employmentNumber.trim()) return 'Anställningsnummer saknas. Ange exakt samma anställningsnummer som personen har i Fortnox.';
    if (!occupationPct) return 'Sysselsättningsgrad saknas.';
    if (occupationMode === 'OTHER' && !occupationOther.trim()) return 'Fyll i annan sysselsättningsgrad (%).';
    if (salaryForm === 'HOURLY' && !hourlyRate.trim()) return 'Timlön saknas.';
    if (salaryForm === 'MONTHLY' && !salary.trim()) return 'Månadslön saknas.';
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

                {/* Timewave-autofyll */}
                <div className="mb-4 relative">
                  <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-brand-accent mb-1">
                    <Users className="w-3 h-3" /> Hämta från Timewave
                  </div>
                  <div className="relative">
                    <UserSearch className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      value={empSearch}
                      onChange={(e) => { setEmpSearch(e.target.value); setEmpSearchOpen(true); }}
                      onFocus={() => setEmpSearchOpen(true)}
                      onBlur={() => setTimeout(() => setEmpSearchOpen(false), 200)}
                      placeholder={twEmployees.length ? `Sök bland ${twEmployees.length} aktiva anställda…` : 'Laddar Timewave-anställda…'}
                      className={`${inp} pl-9`}
                    />
                    {twId && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">TW-id {twId}</span>}
                  </div>
                  {empSearchOpen && filteredEmployees.length > 0 && (
                    <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-y-auto">
                      {filteredEmployees.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          onMouseDown={(ev) => ev.preventDefault()}
                          onClick={() => pickTimewaveEmployee(e)}
                          className="w-full px-3 py-2 text-left hover:bg-brand-accent/5 border-b border-gray-100 last:border-b-0 flex justify-between items-center"
                        >
                          <div>
                            <div className="text-sm font-medium text-brand-dark">
                              {e.first_name} {e.last_name}
                            </div>
                            <div className="text-[11px] text-brand-muted">
                              {e.personal_number || 'saknar personnr'} · {e.email || 'saknar e-post'}
                            </div>
                          </div>
                          {e.base_contract?.occupation && (
                            <span className="text-[10px] text-brand-muted">{e.base_contract.occupation}%</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="text-[11px] text-brand-muted mt-1 italic">
                    Väljer du en anställd fylls <strong>allt</strong> i automatiskt: personnr, kontakt, adress, startdatum,
                    anställningsgrad, befattning och anställningsnummer.
                  </div>
                </div>

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
                  <Field label="Anställningsnummer Fortnox *">
                    <input
                      value={employmentNumber}
                      onChange={(e) => setEmploymentNumber(e.target.value)}
                      placeholder="Exakt som i Fortnox"
                      className={inp}
                    />
                    <div className="text-[10px] text-brand-muted mt-1 italic">
                      Ange exakt samma anställningsnummer som personen har i Fortnox. Får inte auto-genereras eller ändras.
                    </div>
                  </Field>
                  <Field label="Anställningsform *">
                    <select value={employmentForm} onChange={(e) => setEmploymentForm(e.target.value as any)} className={inp}>
                      <option value="TILLSVIDARE">Tillsvidareanställning</option>
                      <option value="PROV">Provanställning</option>
                      <option value="VISSTID">Visstidsanställning</option>
                      <option value="TIM">Timanställning</option>
                    </select>
                  </Field>
                  <Field label="Befattning *"><input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Städare, Teamledare…" className={inp} /></Field>
                  <Field label="Sysselsättningsgrad *">
                    <select
                      value={occupationMode}
                      onChange={(e) => setOccupationMode(e.target.value as any)}
                      className={inp}
                    >
                      <option value="ON_DEMAND">Vid behov (standard)</option>
                      <option value="25">25 %</option>
                      <option value="50">50 %</option>
                      <option value="75">75 %</option>
                      <option value="80">80 %</option>
                      <option value="100">100 %</option>
                      <option value="OTHER">Annan %</option>
                    </select>
                    {occupationMode === 'OTHER' && (
                      <input
                        value={occupationOther}
                        onChange={(e) => setOccupationOther(e.target.value)}
                        placeholder="Ex: 60"
                        type="number"
                        className={`${inp} mt-2`}
                      />
                    )}
                  </Field>
                  <Field label="Tillträdesdag *">
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        const v = e.target.value;
                        setStartDate(v);
                        if (employmentForm === 'TIM' && v) setEndDate(autoTimEnd(v));
                      }}
                      className={inp}
                    />
                  </Field>
                  {employmentForm === 'VISSTID' && (
                    <Field label="Slutdatum *"><input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inp} /></Field>
                  )}
                  {employmentForm === 'TIM' && (
                    <Field label="Slutdatum * (max 1 år från tillträde)">
                      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inp} />
                    </Field>
                  )}
                  {employmentForm === 'PROV' && (
                    <Field label="Provanställning t.o.m. *"><input type="date" value={probationEndDate} onChange={(e) => setProbationEndDate(e.target.value)} className={inp} /></Field>
                  )}
                  <Field label="Arbetsområde"><input value={workArea} onChange={(e) => setWorkArea(e.target.value)} placeholder="Stockholm med omnejd" className={inp} /></Field>
                  <Field label="Arbetsplats (specifik)"><input value={workplace} onChange={(e) => setWorkplace(e.target.value)} placeholder="Ex: hos våra kunder" className={inp} /></Field>
                  <Field label="Bankkonto för lön"><input value={bankAccount} onChange={(e) => setBankAccount(e.target.value)} placeholder="Ex: Nordea 3300 · 12 34 567 890 1" className={inp} /></Field>
                </div>

                {/* LÖNEFORM — explicit val Timlön vs Månadslön */}
                <div className="mt-4 p-4 bg-brand-bg/40 border border-gray-200 rounded-lg">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-brand-muted mb-3">Löneform *</div>
                  <div className="grid grid-cols-2 gap-3 mb-3">
                    <button
                      type="button"
                      onClick={() => setSalaryForm('HOURLY')}
                      className={`p-3 text-left rounded-lg border-2 ${
                        salaryForm === 'HOURLY' ? 'border-brand-dark bg-white' : 'border-gray-200 bg-white hover:border-brand-accent'
                      }`}
                    >
                      <div className="font-semibold text-brand-dark text-sm">Timlön</div>
                      <div className="text-[11px] text-brand-muted mt-0.5">XX kr/timme</div>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSalaryForm('MONTHLY')}
                      className={`p-3 text-left rounded-lg border-2 ${
                        salaryForm === 'MONTHLY' ? 'border-brand-dark bg-white' : 'border-gray-200 bg-white hover:border-brand-accent'
                      }`}
                    >
                      <div className="font-semibold text-brand-dark text-sm">Månadslön</div>
                      <div className="text-[11px] text-brand-muted mt-0.5">XX XXX kr/månad</div>
                    </button>
                  </div>

                  {salaryForm === 'HOURLY' ? (
                    <>
                      <Field label="Timlön (kr/timme) *">
                        <input value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} type="number" placeholder="Ex: 185" className={inp} />
                      </Field>
                      <label className="mt-3 flex items-start gap-2 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={vacationIncludedInHourly}
                          onChange={(e) => setVacationIncludedInHourly(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>
                          <strong>Timlönen inkluderar semesterersättning</strong> (12 % ingår i timlönen)
                          <div className="text-[11px] text-brand-muted mt-0.5 font-normal">
                            Bocka ur om semesterersättning ska hanteras separat.
                          </div>
                        </span>
                      </label>
                    </>
                  ) : (
                    <Field label="Månadslön (kr/månad) *">
                      <input value={salary} onChange={(e) => setSalary(e.target.value)} type="number" placeholder="Ex: 29500" className={inp} />
                    </Field>
                  )}
                </div>
                <Field label="Arbetstid"><input value={workHours} onChange={(e) => setWorkHours(e.target.value)} className={inp} /></Field>
                <Field label="Semester"><input value={vacation} onChange={(e) => setVacation(e.target.value)} className={inp} /></Field>
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
