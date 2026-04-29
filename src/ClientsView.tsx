import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Plus, Search, ShieldAlert, X } from 'lucide-react';
import { api } from './lib/api';
import {
  ClientAlert,
  ClientAlertModal,
  useClientAlertGate,
} from './components/ClientAlertModal';

interface ClientRow {
  id: number;
  clientNumber: string;
  name: string;
  type: 'PRIVATE' | 'COMPANY';
  phone: string | null;
  email: string | null;
  status: 'PROSPECT' | 'ACTIVE' | 'PAUSED' | 'TERMINATED';
  rutEligible: boolean;
  hasBlockerAlert: boolean;
}

interface ClientDetail extends ClientRow {
  addresses: Array<{
    id: number;
    type: 'INVOICE' | 'SERVICE';
    street: string;
    zip: string;
    city: string;
  }>;
  alerts: ClientAlert[];
  orgNumber: string | null;
  personalNumber: string | null;
  priceModel: 'HOURLY' | 'FIXED' | 'SUBSCRIPTION';
  invoiceMethod: 'EMAIL' | 'POST' | 'E_INVOICE';
  paymentTermsDays: number;
  fortnoxCustomerId: string | null;
}

export default function ClientsView() {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [creatingNew, setCreatingNew] = useState(false);
  const { gate, modal } = useClientAlertGate();

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const q = new URLSearchParams();
      if (query) q.set('q', query);
      const data = await api<{ data: ClientRow[] }>(`/api/clients?${q}`);
      setRows(data.data);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    const t = setTimeout(loadList, 200);
    return () => clearTimeout(t);
  }, [loadList]);

  const openClient = (row: ClientRow) => {
    // Alert gate: opens the alert modal if there are blockers, else goes straight to detail
    gate(row.id, row.name, () => setSelectedId(row.id));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Sök kund (namn, nummer, org.nr, e-post)"
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:border-brand-accent"
          />
        </div>
        <button
          onClick={() => setCreatingNew(true)}
          className="flex items-center gap-2 px-4 py-2 bg-brand-accent text-white rounded-lg text-sm font-medium hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Ny kund
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
            <tr>
              <th className="text-left px-4 py-3">#</th>
              <th className="text-left px-4 py-3">Namn</th>
              <th className="text-left px-4 py-3">Typ</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Kontakt</th>
              <th className="text-left px-4 py-3">Varning</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Laddar…
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                  Inga kunder
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                onClick={() => openClient(r)}
                className="border-t border-gray-100 hover:bg-gray-50 cursor-pointer"
              >
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{r.clientNumber}</td>
                <td className="px-4 py-3 font-medium text-gray-900">{r.name}</td>
                <td className="px-4 py-3 text-gray-600">
                  {r.type === 'PRIVATE' ? 'Privat' : 'Företag'}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                </td>
                <td className="px-4 py-3 text-gray-600">{r.email ?? r.phone ?? '—'}</td>
                <td className="px-4 py-3">
                  {r.hasBlockerAlert ? (
                    <div className="inline-flex items-center gap-1 text-red-700 text-xs font-medium">
                      <ShieldAlert className="w-4 h-4" /> Öppna för att läsa
                    </div>
                  ) : (
                    <span className="text-gray-300">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Alert gate modal */}
      {modal}

      {/* Detail drawer */}
      {selectedId && (
        <ClientDetailDrawer
          clientId={selectedId}
          onClose={() => {
            setSelectedId(null);
            loadList();
          }}
        />
      )}

      {creatingNew && (
        <NewClientDialog
          onClose={() => setCreatingNew(false)}
          onCreated={() => {
            setCreatingNew(false);
            loadList();
          }}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    ACTIVE: 'bg-green-100 text-green-800',
    PROSPECT: 'bg-blue-100 text-blue-800',
    PAUSED: 'bg-yellow-100 text-yellow-800',
    TERMINATED: 'bg-gray-100 text-gray-500',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${map[status] ?? ''}`}>
      {status.toLowerCase()}
    </span>
  );
}

function ClientDetailDrawer({ clientId, onClose }: { clientId: number; onClose: () => void }) {
  const [client, setClient] = useState<ClientDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<'info' | 'alerts' | 'agreements'>('info');

  const reload = useCallback(() => {
    api<ClientDetail>(`/api/clients/${clientId}`)
      .then(setClient)
      .catch((e) => setError(e.message));
  }, [clientId]);

  useEffect(() => {
    reload();
  }, [reload]);

  if (error) {
    return (
      <Drawer onClose={onClose}>
        <div className="p-6 text-red-600">{error}</div>
      </Drawer>
    );
  }
  if (!client) {
    return (
      <Drawer onClose={onClose}>
        <div className="p-6 text-gray-400">Laddar…</div>
      </Drawer>
    );
  }

  const activeAlerts = client.alerts.filter((a) => a.severity === 'BLOCKER' || a.severity === 'WARNING');

  return (
    <Drawer onClose={onClose}>
      <div className="p-6 border-b border-gray-100">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-mono text-gray-400">{client.clientNumber}</p>
            <h2 className="text-2xl font-serif text-gray-900">{client.name}</h2>
            <div className="flex items-center gap-2 mt-2">
              <StatusBadge status={client.status} />
              {client.rutEligible && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                  RUT
                </span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:bg-gray-100 rounded-lg"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        {activeAlerts.length > 0 && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex gap-2 text-sm text-red-800">
            <AlertTriangle className="w-4 h-4 mt-0.5" />
            <span>
              {activeAlerts.length} aktiv{activeAlerts.length === 1 ? '' : 'a'} varning
              {activeAlerts.length === 1 ? '' : 'ar'}. Se fliken "Varningar".
            </span>
          </div>
        )}
      </div>

      <div className="border-b border-gray-100 px-6">
        <TabButton active={tab === 'info'} onClick={() => setTab('info')}>
          Info
        </TabButton>
        <TabButton active={tab === 'alerts'} onClick={() => setTab('alerts')}>
          Varningar ({client.alerts.length})
        </TabButton>
        <TabButton active={tab === 'agreements'} onClick={() => setTab('agreements')}>
          Avtal
        </TabButton>
      </div>

      <div className="p-6 overflow-auto flex-1">
        {tab === 'info' && <InfoTab client={client} />}
        {tab === 'alerts' && <AlertsTab client={client} onChange={reload} />}
        {tab === 'agreements' && (
          <div className="text-sm text-gray-500">Kopplade avtal laddas i kommande version.</div>
        )}
      </div>
    </Drawer>
  );
}

function InfoTab({ client }: { client: ClientDetail }) {
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
      <div>
        <dt className="text-xs text-gray-400 uppercase">Typ</dt>
        <dd className="text-gray-900">{client.type === 'PRIVATE' ? 'Privatperson' : 'Företag'}</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-400 uppercase">Org./pers.nr</dt>
        <dd className="text-gray-900">{client.orgNumber ?? client.personalNumber ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-400 uppercase">E-post</dt>
        <dd className="text-gray-900">{client.email ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-400 uppercase">Telefon</dt>
        <dd className="text-gray-900">{client.phone ?? '—'}</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-400 uppercase">Prismodell</dt>
        <dd className="text-gray-900">{client.priceModel}</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-400 uppercase">Betalningsvillkor</dt>
        <dd className="text-gray-900">{client.paymentTermsDays} dagar</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-400 uppercase">Fakturametod</dt>
        <dd className="text-gray-900">{client.invoiceMethod}</dd>
      </div>
      <div>
        <dt className="text-xs text-gray-400 uppercase">Fortnox-ID</dt>
        <dd className="text-gray-900 font-mono text-xs">{client.fortnoxCustomerId ?? '—'}</dd>
      </div>
      <div className="col-span-2 mt-4">
        <dt className="text-xs text-gray-400 uppercase mb-2">Adresser</dt>
        {client.addresses.length === 0 ? (
          <dd className="text-gray-500 italic">Inga adresser registrerade</dd>
        ) : (
          <dd className="space-y-2">
            {client.addresses.map((a) => (
              <div key={a.id} className="p-3 border border-gray-100 rounded-lg text-gray-800">
                <div className="text-xs text-gray-400 uppercase mb-1">{a.type === 'INVOICE' ? 'Fakturaadress' : 'Tjänsteadress'}</div>
                {a.street}, {a.zip} {a.city}
              </div>
            ))}
          </dd>
        )}
      </div>
    </dl>
  );
}

function AlertsTab({ client, onChange }: { client: ClientDetail; onChange: () => void }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Varningar & ekonomi-noter</h3>
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1 text-xs text-brand-accent hover:underline"
        >
          <Plus className="w-3 h-3" /> Lägg till
        </button>
      </div>
      {client.alerts.length === 0 && (
        <p className="text-sm text-gray-400 italic">Inga varningar</p>
      )}
      {client.alerts.map((a) => (
        <div
          key={a.id}
          className={`p-4 rounded-lg border ${
            a.severity === 'BLOCKER'
              ? 'border-red-200 bg-red-50'
              : a.severity === 'WARNING'
              ? 'border-orange-200 bg-orange-50'
              : 'border-blue-200 bg-blue-50'
          }`}
        >
          <div className="flex items-center gap-2 text-xs uppercase tracking-wide">
            <span className="font-semibold">{a.severity}</span>
            <span className="text-gray-500">· {a.category}</span>
          </div>
          <h4 className="font-semibold mt-1">{a.title}</h4>
          <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{a.body}</p>
          <button
            onClick={async () => {
              if (!confirm('Avaktivera denna varning?')) return;
              await api(`/api/clients/${client.id}/alerts/${a.id}`, { method: 'DELETE' });
              onChange();
            }}
            className="text-xs text-gray-500 hover:text-red-600 mt-2"
          >
            Avaktivera
          </button>
        </div>
      ))}
      {adding && (
        <NewAlertForm
          clientId={client.id}
          onClose={() => setAdding(false)}
          onCreated={() => {
            setAdding(false);
            onChange();
          }}
        />
      )}
    </div>
  );
}

function NewAlertForm({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [severity, setSeverity] = useState<'INFO' | 'WARNING' | 'BLOCKER'>('BLOCKER');
  const [category, setCategory] = useState<'ECONOMY' | 'CREDIT' | 'PAYMENT' | 'BEHAVIOR' | 'SAFETY' | 'OTHER'>('ECONOMY');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api(`/api/clients/${clientId}/alerts`, {
        method: 'POST',
        body: JSON.stringify({ severity, category, title, body }),
      });
      onCreated();
    } catch (e) {
      alert(`Fel: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 bg-gray-50 border border-gray-200 rounded-lg space-y-3">
      <h4 className="font-medium text-sm">Ny varning</h4>
      <div className="flex gap-3">
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as any)}
          className="px-2 py-1 border border-gray-200 rounded text-sm"
        >
          <option value="BLOCKER">BLOCKER (tvingar kvittens)</option>
          <option value="WARNING">WARNING (syns, ej tvingande)</option>
          <option value="INFO">INFO</option>
        </select>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as any)}
          className="px-2 py-1 border border-gray-200 rounded text-sm"
        >
          <option value="ECONOMY">Ekonomi</option>
          <option value="CREDIT">Kredit</option>
          <option value="PAYMENT">Betalning</option>
          <option value="BEHAVIOR">Beteende</option>
          <option value="SAFETY">Säkerhet</option>
          <option value="OTHER">Övrigt</option>
        </select>
      </div>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Rubrik"
        className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Text (visas för användaren)"
        rows={4}
        className="w-full px-2 py-1 border border-gray-200 rounded text-sm"
      />
      <div className="flex gap-2">
        <button
          disabled={saving || !title || !body}
          onClick={save}
          className="px-3 py-1 bg-brand-accent text-white rounded text-sm disabled:opacity-50"
        >
          Spara
        </button>
        <button onClick={onClose} className="px-3 py-1 text-sm text-gray-600">
          Avbryt
        </button>
      </div>
    </div>
  );
}

function NewClientDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'PRIVATE' | 'COMPANY'>('PRIVATE');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [rutEligible, setRut] = useState(true);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api('/api/clients', {
        method: 'POST',
        body: JSON.stringify({ name, type, email: email || null, phone: phone || null, rutEligible }),
      });
      onCreated();
    } catch (e) {
      alert(`Fel: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 bg-black/30 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4">
        <h2 className="text-xl font-serif">Ny kund</h2>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Namn"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value as any)}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        >
          <option value="PRIVATE">Privatperson</option>
          <option value="COMPANY">Företag</option>
        </select>
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-post"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Telefon"
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={rutEligible} onChange={(e) => setRut(e.target.checked)} />
          RUT-avdrag tillåtet
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-3 py-1.5 text-sm text-gray-600">
            Avbryt
          </button>
          <button
            onClick={save}
            disabled={saving || !name}
            className="px-3 py-1.5 bg-brand-accent text-white rounded-lg text-sm disabled:opacity-50"
          >
            Skapa
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
        active
          ? 'border-brand-accent text-brand-accent'
          : 'border-transparent text-gray-500 hover:text-gray-800'
      }`}
    >
      {children}
    </button>
  );
}

function Drawer({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-2xl bg-white shadow-2xl flex flex-col">{children}</div>
    </div>
  );
}
