import React, { useRef, useState } from 'react';
import { CheckCircle2, Loader2, Upload, XCircle } from 'lucide-react';
import { api } from './lib/api';

interface Summary {
  entity: string;
  created: number;
  updated: number;
  skipped: number;
  errors: number;
  totalRows?: number;
}

const ENTITIES: Array<{ key: string; label: string; hint: string }> = [
  {
    key: 'clients',
    label: 'Kunder',
    hint: 'Fält: id, name (eller first_name+last_name eller company_name), email, phone, org_number, personal_number, status, rut_eligible. Ev. street/zip/city för adress.',
  },
  {
    key: 'client_addresses',
    label: 'Kundadresser (separat fil)',
    hint: 'Fält: client_id (Timewave-id), address_type (INVOICE/SERVICE), street, zip, city, door_code',
  },
  {
    key: 'employees',
    label: 'Anställda',
    hint: 'Fält: first_name, last_name, email, phone, personal_number, hourly_rate, status',
  },
  {
    key: 'services',
    label: 'Tjänster',
    hint: 'Fält: name, description, price (timpris), default_minutes, category',
  },
  {
    key: 'agreements',
    label: 'Avtal (workorders)',
    hint: 'Fält: id (eller workorder_id), client_id, status, valid_from, valid_to, description',
  },
  {
    key: 'agreement_lines',
    label: 'Avtalsrader (workorderlines)',
    hint: 'Fält: id (workorderline_id), workorder_id, service_name, start_time, end_time, recurrence (vecka/varannan/månad), price, crew_size',
  },
  {
    key: 'missions',
    label: 'Schema-pass (bookinglines)',
    hint: 'Fält: id (bookingline_id), client_id, service_name, date, start_time, end_time, crew_size, employee_email (valfri)',
  },
];

export default function ImportView() {
  const [results, setResults] = useState<Record<string, Summary | { error: string }>>({});
  const [running, setRunning] = useState<string | null>(null);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900">
        <p className="font-medium mb-2">Ladda upp CSV eller JSON</p>
        <ol className="list-decimal pl-5 space-y-1 text-blue-900/90">
          <li>Exportera per tabell från Timewave (eller någon annan källa)</li>
          <li>Kör i ordning: <strong>Kunder → Anställda → Tjänster → Avtal → Avtalsrader → Schema-pass</strong></li>
          <li>Allt är idempotent — du kan köra om filer flera gånger</li>
          <li>Kolumnnamn matchas mot vanliga svenska/engelska alias automatiskt</li>
        </ol>
      </div>

      <div className="space-y-4">
        {ENTITIES.map((e) => (
          <UploadCard
            key={e.key}
            entity={e.key}
            label={e.label}
            hint={e.hint}
            running={running === e.key}
            result={results[e.key]}
            onResult={(r) => setResults((prev) => ({ ...prev, [e.key]: r }))}
            onStart={() => setRunning(e.key)}
            onEnd={() => setRunning(null)}
          />
        ))}
      </div>
    </div>
  );
}

function UploadCard({
  entity,
  label,
  hint,
  running,
  result,
  onResult,
  onStart,
  onEnd,
}: {
  entity: string;
  label: string;
  hint: string;
  running: boolean;
  result?: Summary | { error: string };
  onResult: (r: Summary | { error: string }) => void;
  onStart: () => void;
  onEnd: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);

  const submit = async (payload: any) => {
    onStart();
    try {
      const data = await api<Summary>('/api/import/file', {
        method: 'POST',
        body: JSON.stringify({ entity, ...payload }),
      });
      onResult(data);
    } catch (e: any) {
      onResult({ error: e.message });
    } finally {
      onEnd();
    }
  };

  const onFile = async (file: File) => {
    const text = await file.text();
    if (file.name.toLowerCase().endsWith('.json')) {
      submit({ json: text });
    } else {
      submit({ csv: text });
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="font-medium text-gray-900">{label}</h3>
          <p className="text-xs text-gray-500 mt-1">{hint}</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
              if (fileInput.current) fileInput.current.value = '';
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            disabled={running}
            className="flex items-center gap-1 px-3 py-2 bg-brand-accent text-white rounded-lg text-sm disabled:opacity-50"
          >
            {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {running ? 'Importerar…' : 'Välj fil (.csv eller .json)'}
          </button>
          <button
            onClick={() => setShowPaste((v) => !v)}
            disabled={running}
            className="text-xs text-gray-500 hover:text-gray-800 underline"
          >
            klistra in
          </button>
        </div>
      </div>

      {showPaste && (
        <div className="mt-3 space-y-2">
          <textarea
            rows={6}
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Klistra in CSV eller JSON-array här…"
            className="w-full font-mono text-xs px-3 py-2 border border-gray-200 rounded-lg"
          />
          <div className="flex justify-end">
            <button
              disabled={!pasted.trim() || running}
              onClick={() => {
                const trimmed = pasted.trim();
                const looksJson = trimmed.startsWith('[') || trimmed.startsWith('{');
                submit(looksJson ? { json: trimmed } : { csv: trimmed });
              }}
              className="px-3 py-1.5 bg-gray-900 text-white rounded-lg text-sm disabled:opacity-50"
            >
              Importera
            </button>
          </div>
        </div>
      )}

      {result && (
        <div className="mt-3">
          <ResultBadge result={result} />
        </div>
      )}
    </div>
  );
}

function ResultBadge({ result }: { result: Summary | { error: string } }) {
  if ('error' in result) {
    return (
      <div className="flex items-start gap-2 text-sm text-red-700 p-3 bg-red-50 border border-red-200 rounded-lg">
        <XCircle className="w-4 h-4 mt-0.5" /> <span className="break-words">{result.error}</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-sm text-gray-700 p-3 bg-green-50 border border-green-200 rounded-lg">
      <CheckCircle2 className="w-4 h-4 text-green-600" />
      <span>
        +{result.created} skapade · {result.updated} uppdaterade
        {result.skipped > 0 && ` · ${result.skipped} hoppade`}
        {result.errors > 0 && <span className="text-red-700"> · {result.errors} fel</span>}
        {result.totalRows && ` (${result.totalRows} rader totalt)`}
      </span>
    </div>
  );
}
