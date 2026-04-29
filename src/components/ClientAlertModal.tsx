import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Info, X } from 'lucide-react';
import { api } from '../lib/api';

export interface ClientAlert {
  id: number;
  severity: 'INFO' | 'WARNING' | 'BLOCKER';
  category: string;
  title: string;
  body: string;
  createdAt: string;
  requiresAck: boolean;
}

interface Props {
  clientId: number;
  clientName?: string;
  onResolved: () => void;
  onCancel?: () => void;
}

/**
 * Blocker modal: shown when opening a client (or related resource) that has
 * unacknowledged BLOCKER-alerts. User must click "Jag har läst" on each before
 * they can proceed with the action.
 *
 * - INFO/WARNING alerts are shown for context but do not block.
 * - BLOCKER alerts require explicit per-user acknowledgement.
 */
export function ClientAlertModal({ clientId, clientName, onResolved, onCancel }: Props) {
  const [alerts, setAlerts] = useState<ClientAlert[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    api<ClientAlert[]>(`/api/clients/${clientId}/alerts`)
      .then((data) => {
        if (!cancelled) setAlerts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  // No alerts (loaded, empty) → resolve immediately
  useEffect(() => {
    if (alerts && alerts.length === 0) onResolved();
  }, [alerts, onResolved]);

  // All BLOCKER-alerts already ack'd and none requireAck → resolve
  useEffect(() => {
    if (!alerts) return;
    const needsAck = alerts.some((a) => a.requiresAck);
    if (!needsAck) onResolved();
  }, [alerts, onResolved]);

  async function acknowledge(alertId: number) {
    setPending((p) => new Set(p).add(alertId));
    try {
      await api(`/api/clients/${clientId}/alerts/${alertId}/acknowledge`, { method: 'POST' });
      setAlerts((prev) =>
        prev ? prev.map((a) => (a.id === alertId ? { ...a, requiresAck: false } : a)) : prev
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPending((p) => {
        const next = new Set(p);
        next.delete(alertId);
        return next;
      });
    }
  }

  if (error) {
    return (
      <Backdrop>
        <Card>
          <div className="p-6">
            <p className="text-red-600">Kunde inte ladda varningar: {error}</p>
            <button onClick={onCancel} className="mt-4 px-4 py-2 bg-gray-100 rounded-lg">
              Stäng
            </button>
          </div>
        </Card>
      </Backdrop>
    );
  }
  if (!alerts) {
    return (
      <Backdrop>
        <Card>
          <div className="p-6 text-gray-500">Hämtar varningar…</div>
        </Card>
      </Backdrop>
    );
  }
  const needsAck = alerts.filter((a) => a.requiresAck);
  if (needsAck.length === 0) return null;

  return (
    <Backdrop>
      <Card>
        <div className="p-6 border-b border-red-100 bg-red-50 rounded-t-2xl flex items-start gap-3">
          <ShieldAlert className="w-7 h-7 text-red-600 flex-shrink-0 mt-1" />
          <div className="flex-1">
            <h2 className="text-xl font-serif text-red-900">
              Viktiga varningar om {clientName ?? 'denna kund'}
            </h2>
            <p className="text-sm text-red-800 mt-1">
              Läs varje varning och klicka <em>Jag har läst</em> innan du fortsätter. Varje läsning
              loggas.
            </p>
          </div>
          {onCancel && (
            <button
              onClick={onCancel}
              className="p-1 text-red-700 hover:bg-red-100 rounded"
              aria-label="Avbryt"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
        <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-auto">
          {needsAck.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              onAck={() => acknowledge(a.id)}
              loading={pending.has(a.id)}
            />
          ))}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex justify-between items-center">
          <span className="text-xs text-gray-500">
            {needsAck.length} varning{needsAck.length === 1 ? '' : 'ar'} kvar
          </span>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-sm text-gray-600 underline hover:text-gray-900"
            >
              Avbryt och gå tillbaka
            </button>
          )}
        </div>
      </Card>
    </Backdrop>
  );
}

function AlertCard({
  alert,
  onAck,
  loading,
}: {
  alert: ClientAlert;
  onAck: () => void;
  loading: boolean;
}) {
  const icon =
    alert.severity === 'BLOCKER' ? (
      <ShieldAlert className="w-5 h-5 text-red-600" />
    ) : alert.severity === 'WARNING' ? (
      <AlertTriangle className="w-5 h-5 text-orange-500" />
    ) : (
      <Info className="w-5 h-5 text-blue-500" />
    );
  const categoryLabel = (
    {
      ECONOMY: 'Ekonomi',
      CREDIT: 'Kredit',
      PAYMENT: 'Betalning',
      BEHAVIOR: 'Beteende',
      SAFETY: 'Säkerhet',
      OTHER: 'Övrigt',
    } as Record<string, string>
  )[alert.category] ?? alert.category;

  return (
    <div className="border border-red-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 bg-red-50 flex items-center gap-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide text-red-700">
          {categoryLabel}
        </span>
        <span className="text-xs text-red-400 ml-auto">
          {new Date(alert.createdAt).toLocaleDateString('sv-SE')}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-semibold text-gray-900">{alert.title}</h3>
        <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{alert.body}</p>
        <button
          onClick={onAck}
          disabled={loading}
          className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50"
        >
          {loading ? 'Loggar…' : 'Jag har läst'}
        </button>
      </div>
    </div>
  );
}

function Backdrop({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full">{children}</div>
  );
}

/**
 * Convenience hook: wrap any action that "opens" a client resource. The hook
 * returns a function that:
 *  1. checks if the client has requiresAck blocker-alerts
 *  2. if so, renders the modal and only calls `action` after all are ack'd
 *  3. otherwise calls `action` immediately
 */
export function useClientAlertGate() {
  const [state, setState] = useState<
    | null
    | { clientId: number; clientName?: string; action: () => void; cancel?: () => void }
  >(null);

  const gate = (
    clientId: number,
    clientName: string | undefined,
    action: () => void
  ) => {
    setState({
      clientId,
      clientName,
      action: () => {
        setState(null);
        action();
      },
      cancel: () => setState(null),
    });
  };

  const modal = state ? (
    <ClientAlertModal
      clientId={state.clientId}
      clientName={state.clientName}
      onResolved={state.action}
      onCancel={state.cancel}
    />
  ) : null;

  return { gate, modal };
}
