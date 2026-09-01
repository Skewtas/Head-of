/**
 * Public signing-sida. Öppnas via länk i mail: /sign?token=X
 * Ingen Clerk-inloggning krävs — token i URL är åtkomsten.
 */
import { useEffect, useState } from 'react';
import { CheckCircle, Loader, AlertTriangle, FileText, Shield } from 'lucide-react';

interface SigningData {
  contract: { id: number; title: string; status: string; startDate: string | null; endDate: string | null; category: string };
  company: { name: string; organizationNumber: string; signatoryName: string | null };
  person: { firstName: string; lastName: string } | null;
  signer: { id: number; name: string; email: string; status: string; signedAt: string | null; signingOrder: number };
  content: string;
  versionNumber: number;
  expiresAt: string;
}

export default function SigningView() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token') || '';

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SigningData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [personalNumber, setPersonalNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) { setError('Ingen signeringstoken.'); setLoading(false); return; }
    (async () => {
      try {
        const r = await fetch(`/api/contract-signing?token=${encodeURIComponent(token)}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Kunde inte hämta avtalet.');
        setData(j);
        if (j.signer.status === 'SIGNED') setDone(true);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/contract-signing?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ personalNumber, phone, acceptedTerms: accepted }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Signeringen misslyckades.');
      setDone(true);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center">
        <Loader className="w-8 h-8 animate-spin text-brand-muted" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <AlertTriangle className="w-12 h-12 mx-auto text-rose-500" />
          <h1 className="mt-4 text-xl font-semibold text-brand-dark">Länken fungerar inte</h1>
          <p className="mt-2 text-sm text-brand-muted">{error}</p>
          <p className="mt-4 text-xs text-brand-muted">Kontakta din arbetsgivare för en ny länk.</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-brand-bg flex items-center justify-center p-6">
        <div className="max-w-md text-center">
          <div className="w-20 h-20 mx-auto bg-emerald-100 rounded-full flex items-center justify-center">
            <CheckCircle className="w-10 h-10 text-emerald-600" />
          </div>
          <h1 className="mt-6 text-2xl font-serif text-brand-dark">Tack — avtalet är signerat!</h1>
          <p className="mt-2 text-sm text-brand-muted">
            Din signatur har registrerats {data?.signer.signedAt ? `${new Date(data.signer.signedAt).toLocaleString('sv-SE')}` : 'nu'}.
          </p>
          <p className="mt-4 text-sm text-brand-muted">
            När arbetsgivaren också har signerat får du en bekräftelse via mail. Du kan stänga denna sida.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-bg py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-brand-bg/40 flex items-center gap-3">
            <FileText className="w-5 h-5 text-brand-accent" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-brand-dark">{data?.contract.title}</div>
              <div className="text-xs text-brand-muted">{data?.company.name} · Version {data?.versionNumber}</div>
            </div>
          </div>

          {/* Avtalsinnehåll */}
          <div className="p-6 max-h-[60vh] overflow-y-auto border-b border-gray-100">
            <div dangerouslySetInnerHTML={{ __html: data?.content || '' }} />
          </div>

          {/* Signeringsformulär */}
          <div className="p-6 space-y-4 bg-brand-bg/20">
            <div className="flex items-center gap-2 text-sm text-brand-dark font-semibold">
              <Shield className="w-4 h-4 text-brand-accent" />
              Bekräfta din identitet och signera
            </div>
            <p className="text-xs text-brand-muted">
              Genom att fylla i uppgifterna nedan och kryssa i rutan signerar du avtalet elektroniskt.
              Datum, tid, IP-adress och identifieringsuppgifter sparas som signeringsbevis.
            </p>

            <div className="grid grid-cols-1 gap-3">
              <FieldRow label="Personnummer (ÅÅÅÅMMDD-XXXX)">
                <input
                  type="text"
                  value={personalNumber}
                  onChange={(e) => setPersonalNumber(e.target.value)}
                  placeholder="19900314-3329"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-brand-accent"
                />
              </FieldRow>
              <FieldRow label="Telefonnummer">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="070-123 45 67"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-brand-accent"
                />
              </FieldRow>
            </div>

            <label className="flex items-start gap-2 text-sm text-brand-dark cursor-pointer">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                Jag har läst hela avtalet och godkänner det. Jag intygar att jag är
                <strong> {data?.person?.firstName} {data?.person?.lastName}</strong>.
              </span>
            </label>

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-800">
                {error}
              </div>
            )}

            <button
              onClick={submit}
              disabled={submitting || !accepted || !personalNumber || !phone}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-3 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting && <Loader className="w-4 h-4 animate-spin" />}
              Signera avtalet
            </button>
          </div>
        </div>

        <div className="mt-4 text-center text-xs text-brand-muted">
          Länken är giltig till {data?.expiresAt ? new Date(data.expiresAt).toLocaleDateString('sv-SE') : '—'}.
        </div>
      </div>
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-brand-dark uppercase tracking-wider mb-1">{label}</label>
      {children}
    </div>
  );
}
