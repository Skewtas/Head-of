/**
 * PERSONALBREV — enkelt utskicksverktyg för veckobrev (email) och veckosms.
 *
 * Design: ren, varm, avskalad. Ett tydligt flöde:
 *   1. Välj typ (email eller sms)
 *   2. Välj mottagare (alla / avdelning / individ)
 *   3. Skriv innehåll (mall eller fritext)
 *   4. Förhandsgranska + skicka (eller schemalägg)
 *
 * Autosave sparar utkast var 3 sekund.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Mail, MessageSquare, Plus, Send, Users, User, ChevronRight, Loader,
  Check, Copy, Trash2, Clock, X, ArrowLeft, Eye, Sparkles, AlertTriangle,
  Smile,
} from 'lucide-react';
import { api } from './lib/api';

// ─── Emoji-picker ─────────────────────────────────────────────────────
// Enkel, snabb, no-dependencies. Kategorier med de emojis Stodona faktiskt
// använder i personalkommunikation.
const EMOJI_CATEGORIES: Array<{ label: string; emojis: string[] }> = [
  { label: 'Vanligt', emojis: ['✨','💛','🎉','🙏','👏','💪','🌟','✅','☀️','🌸','💫','🔥','❤️','😊','💚','💙'] },
  { label: 'Ansikten', emojis: ['😊','😄','😃','🙂','😉','😍','🥰','😘','🤗','🤔','😌','😎','🥳','😴','☺️','🙌'] },
  { label: 'Hand & Peppning', emojis: ['👍','👏','🙌','💪','🤝','✌️','🙏','👋','🤞','👌','💯','🎯','⭐','🌟','✨','🏆'] },
  { label: 'Hjärtan', emojis: ['❤️','💛','💚','💙','💜','🧡','🤍','🖤','💕','💖','💗','💓','💝','💞','💟','💘'] },
  { label: 'Fira & Fest', emojis: ['🎉','🎊','🥳','🎈','🎁','🎂','🍾','🥂','🎆','🎇','🌈','🎵','🎶','🎀','🎂','🍰'] },
  { label: 'Jobb & Städ', emojis: ['🧹','🧼','🧽','✨','🏠','🚪','🪟','🧴','🧺','🧑‍🔧','📋','📅','⏰','📞','📱','💼'] },
  { label: 'Väder & Årstid', emojis: ['☀️','🌤️','⛅','🌦️','🌧️','⛈️','❄️','☃️','🌨️','🌪️','🌈','🍂','🍁','🌸','🌷','🌻'] },
  { label: 'Symboler', emojis: ['✅','❌','⚠️','ℹ️','💡','📌','🔔','🔴','🟢','🟡','⭐','✔️','➡️','⬅️','↩️','🆕'] },
];

function EmojiPickerPopover({
  onPick, onClose,
}: { onPick: (emoji: string) => void; onClose: () => void }) {
  const [category, setCategory] = useState(0);
  return (
    <div className="absolute z-50 top-full right-0 mt-1 w-80 bg-white rounded-xl border border-gray-200 shadow-xl">
      <div className="flex items-center border-b border-gray-100 px-2 py-1 gap-0.5 overflow-x-auto">
        {EMOJI_CATEGORIES.map((c, i) => (
          <button
            key={c.label}
            onClick={() => setCategory(i)}
            className={`px-2 py-1 text-[11px] rounded whitespace-nowrap ${
              category === i ? 'bg-brand-dark text-white' : 'text-brand-muted hover:bg-gray-100'
            }`}
          >
            {c.label}
          </button>
        ))}
        <button onClick={onClose} className="ml-auto p-1 text-brand-muted hover:text-brand-dark">
          <X className="w-3 h-3" />
        </button>
      </div>
      <div className="grid grid-cols-8 gap-1 p-2 max-h-52 overflow-y-auto">
        {EMOJI_CATEGORIES[category].emojis.map((e, i) => (
          <button
            key={`${category}-${i}`}
            onClick={() => onPick(e)}
            className="text-xl leading-none w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100"
            title={e}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Textarea/input med inbyggd emoji-knapp uppe till höger. */
function InputWithEmoji({
  value, onChange, multiline = false, rows = 3, maxLength, placeholder, className,
}: {
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  rows?: number;
  maxLength?: number;
  placeholder?: string;
  className?: string;
}) {
  const [showPicker, setShowPicker] = useState(false);
  const ref = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);

  const insertAtCursor = (emoji: string) => {
    const el = ref.current;
    if (!el) { onChange((value || '') + emoji); return; }
    const start = (el as any).selectionStart ?? value.length;
    const end = (el as any).selectionEnd ?? value.length;
    const next = value.substring(0, start) + emoji + value.substring(end);
    onChange(next);
    // Placera markören efter emojin efter render
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const pos = start + emoji.length;
      try { (ref.current as any).setSelectionRange(pos, pos); (ref.current as any).focus(); } catch {}
    });
  };

  const baseCls = className ?? 'w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-brand-accent';

  return (
    <div className="relative">
      {multiline ? (
        <textarea
          ref={ref as any}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows}
          maxLength={maxLength}
          placeholder={placeholder}
          className={`${baseCls} pr-9`}
        />
      ) : (
        <input
          ref={ref as any}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={maxLength}
          placeholder={placeholder}
          className={`${baseCls} pr-9`}
        />
      )}
      <button
        type="button"
        onClick={() => setShowPicker((v) => !v)}
        className={`absolute right-2 ${multiline ? 'top-2' : 'top-1/2 -translate-y-1/2'} text-gray-400 hover:text-brand-dark p-1`}
        title="Infoga emoji"
      >
        <Smile className="w-4 h-4" />
      </button>
      {showPicker && (
        <EmojiPickerPopover
          onPick={(e) => insertAtCursor(e)}
          onClose={() => setShowPicker(false)}
        />
      )}
    </div>
  );
}

// ─── Types ─────────────────────────────────────────────────────────────
type MessageType = 'EMAIL' | 'SMS';
type RecipientMode = 'ALL' | 'TEAM' | 'INDIVIDUAL';

interface Draft {
  id: string | null;                  // null = ej sparat än
  type: MessageType;
  title: string;
  subject: string;
  intro: string;
  weekInfo: string;
  keyDates: string;
  outro: string;
  body: string;                       // SMS + fritext-fallback för email
  recipientMode: RecipientMode;
  recipientTeamId: number | null;
  recipientIds: number[];
  scheduledFor: string | null;        // ISO
  useTemplate: boolean;               // struktur (intro/weekInfo/...) vs fritext
  translatedLanguage: string | null;  // t.ex. 'en', 'uk', 'es' etc — översatt version bifogas
  translatedText: string | null;      // AI-genererad översättning (kan redigeras manuellt)
}

const TRANSLATION_LANGUAGES: Array<{ code: string; label: string; flag: string }> = [
  { code: 'en', label: 'Engelska', flag: '🇬🇧' },
  { code: 'uk', label: 'Ukrainska', flag: '🇺🇦' },
  { code: 'es', label: 'Spanska', flag: '🇪🇸' },
  { code: 'sq', label: 'Albanska', flag: '🇦🇱' },
  { code: 'pl', label: 'Polska', flag: '🇵🇱' },
  { code: 'ar', label: 'Arabiska', flag: '🇸🇦' },
  { code: 'ru', label: 'Ryska', flag: '🇷🇺' },
  { code: 'ro', label: 'Rumänska', flag: '🇷🇴' },
];

interface HistoryRow {
  id: string;
  subject: string;
  category: string;                   // 'Personalbrev' | 'Personalbrev-SMS'
  status: string;
  sentAt: string;
  scheduledFor: string | null;
  successCount: number;
  failedCount: number;
  recipients: number[];
  blocks: any;
}

interface RecipientOptions {
  employees: Array<{ id: number; name: string; email: string | null; phone: string | null; teamIds: number[] }>;
  teams: Array<{ id: number; name: string }>;
}

// ─── Mallar ────────────────────────────────────────────────────────────
const EMAIL_TEMPLATES: Array<{ id: string; name: string; desc: string; init: Partial<Draft> }> = [
  {
    id: 'blank',
    name: 'Tomt',
    desc: 'Börja från noll',
    init: { useTemplate: true, subject: '', intro: '', weekInfo: '', keyDates: '', outro: '' },
  },
  {
    id: 'monday-boost',
    name: 'Måndags-peppen',
    desc: 'Starta veckan positivt',
    init: {
      useTemplate: true,
      subject: 'God morgon, nya vecka! ✨',
      intro:
        'Hej fina team,\n\n' +
        'Ny vecka, nya möjligheter. Jag vill börja med att säga TACK för allt fantastiskt jobb ni gör — det märks verkligen ute hos kunderna.',
      weekInfo:
        'Fokus den här veckan:\n' +
        '• Ta hand om varandra och kunderna som vanligt — ni är bäst på det\n' +
        '• Kom ihåg att checka in och ut i tid, så vi kan planera rätt\n' +
        '• Om något krånglar: hör av dig direkt, vi löser det tillsammans',
      keyDates:
        '• Onsdag: teammöte kl. 16.00\n' +
        '• Fredag: löneperiod stängs — se till att alla pass är rapporterade',
      outro:
        'Ni gör en jätteviktig insats varje dag. Kör hårt, ta pauser, och glöm inte att fråga om ni behöver hjälp.\n\n' +
        'Ha en riktigt fin vecka!\n/Mikaela',
    },
  },
  {
    id: 'weekly-summary',
    name: 'Veckans sammanfattning',
    desc: 'Balanserad, lagom',
    init: {
      useTemplate: true,
      subject: 'Veckobrev — allt du behöver veta',
      intro:
        'Hej allihopa,\n\n' +
        'Hoppas ni haft en bra vecka! Här kommer en snabb uppdatering om vad som gäller framöver.',
      weekInfo:
        'Det här är på gång:\n' +
        '• …\n' +
        '• …\n' +
        '• …',
      keyDates:
        '• Måndag: …\n' +
        '• Onsdag: …\n' +
        '• Fredag: …',
      outro:
        'Har du frågor, undringar eller idéer — hojta till! Vi är ett lag.\n\n' +
        'Kram,\n/Mikaela',
    },
  },
  {
    id: 'friday-thanks',
    name: 'Tack för veckan (fredag)',
    desc: 'Fira, tacka, ladda om',
    init: {
      useTemplate: true,
      subject: 'Ni är otroliga — tack för denna vecka! 💛',
      intro:
        'Hej team,\n\n' +
        'Vilken vecka! Jag vill bara passa på att säga hur stolt jag är över er. Varje enskild insats gör skillnad — och det märks.',
      weekInfo:
        'Höjdpunkter från veckan:\n' +
        '• Ni tog hand om extra bokningar utan att blinka\n' +
        '• Kundfeedback: många glada mejl har trillat in ✨\n' +
        '• Ni ställde upp för varandra när det behövdes — det är sådant som gör Stodona till Stodona',
      keyDates:
        'Nästa vecka:\n' +
        '• Schemat är uppdaterat i systemet — kolla dina pass\n' +
        '• Löneutbetalning: senast den 25:e',
      outro:
        'Nu — vila. Ladda batterierna. Umgås med de ni tycker om. Ni har verkligen förtjänat det.\n\n' +
        'Ses på måndag!\n/Mikaela',
    },
  },
  {
    id: 'new-month',
    name: 'Ny månad — nystart',
    desc: 'Sätt tonen för månaden',
    init: {
      useTemplate: true,
      subject: 'Ny månad — vi kör!',
      intro:
        'Hej fina Stodona-familj,\n\n' +
        'En ny månad ligger framför oss. Jag ville skicka en peppning och några ord om vad vi fokuserar på framöver.',
      weekInfo:
        'Så här jobbar vi vidare:\n' +
        '• Kvalitet i varje pass — små saker gör stor skillnad\n' +
        '• Vi håller kommunikationen öppen — säg till om något behövs\n' +
        '• Vi tar hand om varandra — det är så vi växer tillsammans',
      keyDates:
        'Viktiga datum i månaden:\n' +
        '• Personalmöte: … \n' +
        '• Lönedag: den 25:e\n' +
        '• Deadline för semesteransökan: …',
      outro:
        'Ni är hjärtat i det vi bygger. Utan er finns inget Stodona. Tack för att ni är med.\n\n' +
        'Kör hårt, ha kul, och tveka inte att höra av er.\n/Mikaela',
    },
  },
  {
    id: 'welcome-new',
    name: 'Välkomna ny kollega',
    desc: 'Introducera + fira',
    init: {
      useTemplate: true,
      subject: 'Välkommen [Namn] till teamet! 🎉',
      intro:
        'Hej alla,\n\n' +
        'Jag vill så gärna presentera vår nya kollega [Namn], som börjar hos oss den [datum]! Vi är superglada att ha dig med, [Namn] — hoppas du känner dig sedd och välkommen från dag ett.',
      weekInfo:
        'Lite om [Namn]:\n' +
        '• Kommer att jobba främst i [område/team]\n' +
        '• [Kort presentation — ålder, intressen, tidigare erfarenhet]\n' +
        '• Säg hej när du ser hen — vi är bäst på att välkomna nya!',
      keyDates: '',
      outro:
        'Ett stort välkomnande från hela Stodona-familjen. Vi ser fram emot att jobba med dig, [Namn]!\n\n' +
        'Kram,\n/Mikaela',
    },
  },
  {
    id: 'important-notice',
    name: 'Viktig information',
    desc: 'Formell men varm',
    init: {
      useTemplate: true,
      subject: 'Viktigt att läsa — [ämne]',
      intro:
        'Hej alla,\n\n' +
        'Jag vill lyfta något viktigt som berör oss alla. Läs gärna igenom noga.',
      weekInfo:
        'Så här är det:\n' +
        '• Vad har hänt / vad gäller nu\n' +
        '• Vad betyder det för dig i praktiken\n' +
        '• Vad du behöver göra (om något)',
      keyDates: '',
      outro:
        'Har du frågor är du varmt välkommen att höra av dig till mig direkt. Vi går igenom det tillsammans.\n\n' +
        'Tack för att ni tar det här på allvar!\n/Mikaela',
    },
  },
];

const SMS_TEMPLATES: Array<{ id: string; name: string; desc: string; text: string }> = [
  { id: 'blank', name: 'Tomt', desc: 'Skriv fritt', text: '' },
  {
    id: 'monday-pep',
    name: 'Måndags-peppen',
    desc: 'God morgon till hela laget',
    text: 'God morgon {{name}}! ✨ Ny vecka, nya möjligheter. Tack för allt du gör — du är guld värd. Kör hårt och hör av dig om det behövs! /Mikaela',
  },
  {
    id: 'friday-thanks',
    name: 'Tack för veckan',
    desc: 'Fredags-hälsning',
    text: 'Hej {{name}}! Vilken vecka du dragit igenom 💛 Tack för din insats — den märks. Ha en riktigt skön helg, du har förtjänat det!',
  },
  {
    id: 'reminder',
    name: 'Snabb påminnelse',
    desc: 'Vänlig påminnelse',
    text: 'Hej {{name}}! Vänlig påminnelse om [händelse/deadline] den [datum]. Säg till om du undrar något. Tack! /Stodona',
  },
  {
    id: 'schedule',
    name: 'Schemaändring',
    desc: 'När passet flyttas',
    text: 'Hej {{name}}, ditt pass [datum + tid] har flyttats. Nya tiden ser du i schemat. Hör av dig om det inte funkar för dig!',
  },
  {
    id: 'appreciation',
    name: 'Uppskattning',
    desc: 'Fira en insats',
    text: 'Hej {{name}}! Vill bara säga tack för det du gjorde den här veckan — grymt jobbat 💪 Sån som du är hjärtat i Stodona.',
  },
  {
    id: 'urgent',
    name: 'Akut info',
    desc: 'Kort och tydligt',
    text: 'Hej {{name}}, viktigt meddelande: [kort beskrivning]. Ring/sms:a mig om du undrar något. Tack!',
  },
];

// ─── Main ──────────────────────────────────────────────────────────────
export default function PersonalbrevView() {
  const [mode, setMode] = useState<'LIST' | 'COMPOSE'>('LIST');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const loadHistory = useCallback(async () => {
    setLoadingHistory(true);
    try {
      const rows = await api<HistoryRow[]>('/api/personalbrev');
      setHistory(rows);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const startNew = () => { setEditingId(null); setMode('COMPOSE'); };
  const startEdit = (id: string) => { setEditingId(id); setMode('COMPOSE'); };
  const backToList = () => { setEditingId(null); setMode('LIST'); loadHistory(); };

  if (mode === 'COMPOSE') {
    return <ComposeView existingId={editingId} onDone={backToList} />;
  }
  return <ListView history={history} loading={loadingHistory} onOpen={startEdit} onNew={startNew} onChange={loadHistory} />;
}

// ─── LISTA + historik ──────────────────────────────────────────────────
function ListView({
  history, loading, onOpen, onNew, onChange,
}: {
  history: HistoryRow[]; loading: boolean; onOpen: (id: string) => void; onNew: () => void; onChange: () => void;
}) {
  const [filter, setFilter] = useState<'ALL' | 'DRAFT' | 'SCHEDULED' | 'SENT'>('ALL');
  const filtered = useMemo(() => {
    return history.filter((h) => {
      if (filter === 'ALL') return true;
      if (filter === 'DRAFT') return h.status === 'draft';
      if (filter === 'SCHEDULED') return h.status === 'scheduled';
      return h.status === 'sent' || h.status === 'partial';
    });
  }, [history, filter]);

  const duplicate = async (id: string) => {
    const copy = await api<{ id: string }>(`/api/personalbrev/${id}/duplicate`, { method: 'POST' });
    onChange();
    onOpen(copy.id);
  };
  const remove = async (id: string) => {
    if (!confirm('Radera detta utkast?')) return;
    await api(`/api/personalbrev/${id}`, { method: 'DELETE' });
    onChange();
  };

  return (
    <div className="p-8 bg-brand-bg min-h-[calc(100vh-64px)] max-w-5xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-serif text-brand-dark flex items-center gap-2">
            <Mail className="w-5 h-5 text-brand-accent" />
            Personalbrev
          </h1>
          <p className="mt-1 text-sm text-brand-muted max-w-xl">
            Skicka veckobrev eller sms till personalen. Från idé till skickat på under två minuter.
          </p>
        </div>
        <button
          onClick={onNew}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-dark/90 shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Skapa nytt utskick
        </button>
      </div>

      <div className="flex items-center gap-2 mb-4 text-xs">
        {([
          { k: 'ALL', label: `Alla (${history.length})` },
          { k: 'DRAFT', label: `Utkast (${history.filter((h) => h.status === 'draft').length})` },
          { k: 'SCHEDULED', label: `Schemalagt (${history.filter((h) => h.status === 'scheduled').length})` },
          { k: 'SENT', label: `Skickat (${history.filter((h) => h.status === 'sent' || h.status === 'partial').length})` },
        ] as const).map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`px-3 py-1 rounded-full border ${
              filter === f.k
                ? 'bg-brand-dark text-white border-brand-dark'
                : 'bg-white text-brand-muted border-gray-200 hover:bg-gray-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="py-16 text-center text-brand-muted">
          <Loader className="animate-spin mx-auto" size={22} />
          <div className="mt-2 text-sm">Laddar…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center border border-dashed border-gray-300 rounded-xl bg-white">
          <Mail className="mx-auto text-gray-300" size={40} />
          <div className="mt-3 text-sm text-brand-muted">Inga utskick här ännu.</div>
          <button
            onClick={onNew}
            className="mt-5 inline-flex items-center gap-2 px-4 py-2 bg-brand-dark text-white rounded-lg text-sm font-medium hover:bg-brand-dark/90"
          >
            <Plus className="w-4 h-4" /> Skapa ditt första
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((h) => {
            const isSms = h.category === 'Personalbrev-SMS';
            const Icon = isSms ? MessageSquare : Mail;
            const statusMeta: Record<string, { label: string; cls: string }> = {
              draft:     { label: 'Utkast',     cls: 'bg-gray-100 text-gray-700' },
              scheduled: { label: 'Schemalagt', cls: 'bg-sky-100 text-sky-800' },
              sending:   { label: 'Skickar…',   cls: 'bg-amber-100 text-amber-800' },
              sent:      { label: 'Skickat',    cls: 'bg-emerald-100 text-emerald-800' },
              partial:   { label: 'Delvis',     cls: 'bg-amber-100 text-amber-800' },
              failed:    { label: 'Misslyckades', cls: 'bg-rose-100 text-rose-800' },
            };
            const sm = statusMeta[h.status] || { label: h.status, cls: 'bg-gray-100 text-gray-700' };
            const when =
              h.status === 'scheduled' && h.scheduledFor
                ? `Skickas ${new Date(h.scheduledFor).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : h.status === 'sent' || h.status === 'partial'
                  ? `Skickat ${new Date(h.sentAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}`
                  : `Uppdaterad ${new Date(h.sentAt).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' })}`;
            return (
              <div key={h.id} className="bg-white border border-gray-200 rounded-lg hover:border-brand-accent transition-colors">
                <div className="p-4 flex items-center gap-4">
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${
                    isSms ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <button onClick={() => onOpen(h.id)} className="flex-1 min-w-0 text-left">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-brand-dark truncate">{h.subject}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${sm.cls}`}>{sm.label}</span>
                    </div>
                    <div className="text-xs text-brand-muted mt-0.5">
                      {when}
                      {(h.status === 'sent' || h.status === 'partial') && (
                        <span> · {h.successCount} skickat{h.failedCount > 0 ? `, ${h.failedCount} misslyckades` : ''}</span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={() => duplicate(h.id)}
                    className="p-2 text-brand-muted hover:text-brand-dark rounded"
                    title="Kopiera"
                  >
                    <Copy className="w-4 h-4" />
                  </button>
                  {h.status !== 'sent' && h.status !== 'partial' && (
                    <button
                      onClick={() => remove(h.id)}
                      className="p-2 text-brand-muted hover:text-rose-600 rounded"
                      title="Radera utkast"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── COMPOSE — hela redigeraren ────────────────────────────────────────
function ComposeView({ existingId, onDone }: { existingId: string | null; onDone: () => void }) {
  const [draft, setDraft] = useState<Draft>({
    id: null,
    type: 'EMAIL',
    title: '',
    subject: '',
    intro: '',
    weekInfo: '',
    keyDates: '',
    outro: '',
    body: '',
    recipientMode: 'ALL',
    recipientTeamId: null,
    recipientIds: [],
    scheduledFor: null,
    useTemplate: true,
    translatedLanguage: null,
    translatedText: null,
  });
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [options, setOptions] = useState<RecipientOptions | null>(null);
  const [loading, setLoading] = useState(!!existingId);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [sending, setSending] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [sentResult, setSentResult] = useState<{ sent: number; failed: number } | null>(null);
  const saveTimer = useRef<any>(null);

  // Hämta options + existing draft parallellt
  useEffect(() => {
    (async () => {
      const opts = await api<RecipientOptions>('/api/personalbrev/recipient-options');
      setOptions(opts);
      if (existingId) {
        const row = await api<any>(`/api/personalbrev/${existingId}`);
        const b = row.blocks || {};
        setDraft({
          id: row.id,
          type: row.category === 'Personalbrev-SMS' ? 'SMS' : 'EMAIL',
          title: b.title || row.subject || '',
          subject: b.subject || row.subject || '',
          intro: b.intro || '',
          weekInfo: b.weekInfo || '',
          keyDates: b.keyDates || '',
          outro: b.outro || '',
          body: b.body || '',
          recipientMode: b.recipientMode || 'INDIVIDUAL',
          recipientTeamId: b.recipientTeamId ?? null,
          recipientIds: b.recipientIds || row.recipients || [],
          scheduledFor: row.scheduledFor,
          useTemplate: !!(b.intro || b.weekInfo || b.keyDates || b.outro),
        });
        // Skickat/schemalagt → hoppa till förhandsvisning
        if (row.status === 'sent' || row.status === 'scheduled' || row.status === 'partial') {
          setStep(4);
        }
      }
      setLoading(false);
    })();
  }, [existingId]);

  // Autosave med debounce 1500 ms
  useEffect(() => {
    if (loading) return;
    if (!draft.subject && !draft.body && !draft.intro && !draft.weekInfo) return; // tomt utkast
    clearTimeout(saveTimer.current);
    setSaveStatus('idle');
    saveTimer.current = setTimeout(async () => {
      setSaveStatus('saving');
      try {
        if (draft.id) {
          await api(`/api/personalbrev/${draft.id}`, { method: 'PUT', body: JSON.stringify(toBody(draft)) });
        } else {
          const created = await api<{ id: string }>(`/api/personalbrev`, { method: 'POST', body: JSON.stringify(toBody(draft)) });
          setDraft((d) => ({ ...d, id: created.id }));
        }
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 1500);
      } catch { setSaveStatus('idle'); }
    }, 1500);
    return () => clearTimeout(saveTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.subject, draft.intro, draft.weekInfo, draft.keyDates, draft.outro, draft.body, draft.recipientIds, draft.recipientMode, draft.recipientTeamId, draft.type, draft.scheduledFor]);

  // Beräkna resolved-recipients baserat på mode
  const resolvedIds = useMemo(() => {
    if (!options) return draft.recipientIds;
    if (draft.recipientMode === 'ALL') {
      return options.employees
        .filter((e) => draft.type === 'EMAIL' ? !!e.email : !!e.phone)
        .map((e) => e.id);
    }
    if (draft.recipientMode === 'TEAM' && draft.recipientTeamId != null) {
      return options.employees
        .filter((e) => e.teamIds.includes(draft.recipientTeamId!))
        .filter((e) => draft.type === 'EMAIL' ? !!e.email : !!e.phone)
        .map((e) => e.id);
    }
    return draft.recipientIds;
  }, [options, draft.recipientMode, draft.recipientTeamId, draft.recipientIds, draft.type]);

  // Sync resolvedIds → draft.recipientIds vid mode-byte
  useEffect(() => {
    if (draft.recipientMode !== 'INDIVIDUAL') {
      setDraft((d) => ({ ...d, recipientIds: resolvedIds }));
    }
  }, [draft.recipientMode, draft.recipientTeamId, resolvedIds]);

  const send = async () => {
    if (!draft.id) return;
    setSending(true);
    try {
      const r = await api<{ sent: number; failed: number }>(`/api/personalbrev/${draft.id}/send`, { method: 'POST' });
      setSentResult(r);
      setConfirmSend(false);
    } catch (e: any) {
      alert('Kunde inte skicka: ' + (e?.message || 'okänt fel'));
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="p-16 text-center text-brand-muted">
        <Loader className="animate-spin mx-auto" size={22} />
      </div>
    );
  }

  // Bekräftelsevy när skickat
  if (sentResult) {
    return (
      <div className="p-16 max-w-lg mx-auto text-center">
        <div className="w-16 h-16 mx-auto bg-emerald-100 rounded-full flex items-center justify-center">
          <Check className="w-8 h-8 text-emerald-600" />
        </div>
        <h2 className="mt-6 text-2xl font-serif text-brand-dark">Utskick klart!</h2>
        <p className="mt-2 text-sm text-brand-muted">
          {sentResult.sent} {draft.type === 'EMAIL' ? 'email' : 'sms'} skickat
          {sentResult.failed > 0 && <> · {sentResult.failed} misslyckades</>}
        </p>
        <button
          onClick={onDone}
          className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 bg-brand-dark text-white rounded-lg text-sm font-semibold"
        >
          Tillbaka till listan
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 bg-brand-bg min-h-[calc(100vh-64px)] max-w-3xl mx-auto">
      {/* Header med tillbaka + save-status */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={onDone}
          className="inline-flex items-center gap-1.5 text-sm text-brand-muted hover:text-brand-dark"
        >
          <ArrowLeft className="w-4 h-4" /> Alla utskick
        </button>
        <div className="text-xs text-brand-muted">
          {saveStatus === 'saving' && <span className="inline-flex items-center gap-1"><Loader className="w-3 h-3 animate-spin" /> Sparar…</span>}
          {saveStatus === 'saved' && <span className="inline-flex items-center gap-1 text-emerald-600"><Check className="w-3 h-3" /> Sparat</span>}
        </div>
      </div>

      {/* Steg-indikator */}
      <div className="flex items-center gap-2 mb-8">
        {[1, 2, 3, 4].map((s) => (
          <div
            key={s}
            className={`h-1.5 flex-1 rounded-full ${s <= step ? 'bg-brand-dark' : 'bg-gray-200'}`}
          />
        ))}
      </div>

      {step === 1 && <StepType draft={draft} setDraft={setDraft} onNext={() => setStep(2)} />}
      {step === 2 && <StepRecipients draft={draft} setDraft={setDraft} options={options} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && <StepContent draft={draft} setDraft={setDraft} onBack={() => setStep(2)} onNext={() => setStep(4)} />}
      {step === 4 && (
        <StepPreview
          draft={draft}
          setDraft={setDraft}
          options={options}
          onBack={() => setStep(3)}
          onSend={() => setConfirmSend(true)}
        />
      )}

      {confirmSend && (
        <ConfirmDialog
          draft={draft}
          resolvedCount={resolvedIds.length}
          sending={sending}
          onCancel={() => setConfirmSend(false)}
          onConfirm={send}
        />
      )}
    </div>
  );
}

// ─── STEG 1 — TYP ─────────────────────────────────────────────────────
function StepType({ draft, setDraft, onNext }: { draft: Draft; setDraft: (d: Draft) => void; onNext: () => void }) {
  return (
    <div>
      <h2 className="text-xl font-serif text-brand-dark mb-1">Vad vill du skicka?</h2>
      <p className="text-sm text-brand-muted mb-6">Välj typ av utskick.</p>
      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => setDraft({ ...draft, type: 'EMAIL' })}
          className={`p-6 rounded-xl border-2 transition-all text-left ${
            draft.type === 'EMAIL'
              ? 'border-brand-dark bg-white shadow-sm'
              : 'border-gray-200 bg-white hover:border-brand-accent'
          }`}
        >
          <Mail className="w-8 h-8 text-amber-600 mb-3" />
          <div className="font-semibold text-brand-dark">Veckobrev</div>
          <div className="text-xs text-brand-muted mt-1">
            Längre meddelande med rubrik, inledning, veckans information och viktiga datum.
          </div>
        </button>
        <button
          onClick={() => setDraft({ ...draft, type: 'SMS' })}
          className={`p-6 rounded-xl border-2 transition-all text-left ${
            draft.type === 'SMS'
              ? 'border-brand-dark bg-white shadow-sm'
              : 'border-gray-200 bg-white hover:border-brand-accent'
          }`}
        >
          <MessageSquare className="w-8 h-8 text-blue-600 mb-3" />
          <div className="font-semibold text-brand-dark">Veckosms</div>
          <div className="text-xs text-brand-muted mt-1">
            Kort meddelande, max 918 tecken. Direkt till personalens telefon.
          </div>
        </button>
      </div>
      <div className="mt-8 flex justify-end">
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-dark/90"
        >
          Fortsätt <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ─── STEG 2 — MOTTAGARE ────────────────────────────────────────────────
function StepRecipients({
  draft, setDraft, options, onBack, onNext,
}: {
  draft: Draft; setDraft: (d: Draft) => void; options: RecipientOptions | null;
  onBack: () => void; onNext: () => void;
}) {
  if (!options) return <div className="text-brand-muted">Laddar personallista…</div>;

  const contactField = draft.type === 'EMAIL' ? 'email' : 'phone';
  const reachable = options.employees.filter((e) => !!e[contactField]);
  const missing = options.employees.length - reachable.length;

  const toggleIndividual = (id: number) => {
    const set = new Set(draft.recipientIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setDraft({ ...draft, recipientIds: Array.from(set) });
  };

  return (
    <div>
      <h2 className="text-xl font-serif text-brand-dark mb-1">Vem ska ta emot?</h2>
      <p className="text-sm text-brand-muted mb-6">
        {reachable.length} av {options.employees.length} anställda har {draft.type === 'EMAIL' ? 'en e-postadress' : 'ett telefonnummer'} registrerat.
        {missing > 0 && <> ({missing} kan inte nås.)</>}
      </p>

      <div className="grid gap-2 mb-4">
        <RecipientModeCard
          icon={Users} title="All personal" desc={`Alla ${reachable.length} nåbara anställda`}
          active={draft.recipientMode === 'ALL'}
          onClick={() => setDraft({ ...draft, recipientMode: 'ALL' })}
        />
        <RecipientModeCard
          icon={Users} title="En avdelning" desc={draft.recipientMode === 'TEAM' && draft.recipientTeamId
            ? options.teams.find((t) => t.id === draft.recipientTeamId)?.name || 'Välj avdelning'
            : 'Välj bland avdelningar/team'}
          active={draft.recipientMode === 'TEAM'}
          onClick={() => setDraft({ ...draft, recipientMode: 'TEAM' })}
        />
        <RecipientModeCard
          icon={User} title="Enskilda personer" desc={draft.recipientMode === 'INDIVIDUAL'
            ? `${draft.recipientIds.length} valda` : 'Välj individuellt'}
          active={draft.recipientMode === 'INDIVIDUAL'}
          onClick={() => setDraft({ ...draft, recipientMode: 'INDIVIDUAL' })}
        />
      </div>

      {draft.recipientMode === 'TEAM' && (
        <div className="grid grid-cols-2 gap-2 mb-4">
          {options.teams.map((t) => (
            <button
              key={t.id}
              onClick={() => setDraft({ ...draft, recipientTeamId: t.id })}
              className={`px-3 py-2 text-sm rounded-lg border ${
                draft.recipientTeamId === t.id
                  ? 'border-brand-dark bg-brand-dark text-white'
                  : 'border-gray-200 bg-white text-brand-dark hover:border-brand-accent'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {draft.recipientMode === 'INDIVIDUAL' && (
        <div className="max-h-64 overflow-y-auto bg-white border border-gray-200 rounded-lg mb-4">
          {reachable.map((e) => (
            <label
              key={e.id}
              className="flex items-center gap-3 px-3 py-2 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={draft.recipientIds.includes(e.id)}
                onChange={() => toggleIndividual(e.id)}
                className="rounded"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-brand-dark">{e.name}</div>
                <div className="text-xs text-brand-muted truncate">
                  {draft.type === 'EMAIL' ? e.email : e.phone}
                </div>
              </div>
            </label>
          ))}
        </div>
      )}

      <div className="flex justify-between">
        <button onClick={onBack} className="text-sm text-brand-muted hover:text-brand-dark">
          ← Tillbaka
        </button>
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-dark/90"
        >
          Fortsätt <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function RecipientModeCard({
  icon: Icon, title, desc, active, onClick,
}: { icon: any; title: string; desc: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`p-4 rounded-xl border-2 flex items-center gap-3 text-left ${
        active ? 'border-brand-dark bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-brand-accent'
      }`}
    >
      <div className={`w-9 h-9 rounded-full flex items-center justify-center ${active ? 'bg-brand-dark text-white' : 'bg-gray-100 text-brand-muted'}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1">
        <div className="font-semibold text-brand-dark text-sm">{title}</div>
        <div className="text-xs text-brand-muted">{desc}</div>
      </div>
      {active && <Check className="w-4 h-4 text-brand-dark" />}
    </button>
  );
}

// ─── STEG 3 — INNEHÅLL ─────────────────────────────────────────────────
function StepContent({
  draft, setDraft, onBack, onNext,
}: { draft: Draft; setDraft: (d: Draft) => void; onBack: () => void; onNext: () => void }) {
  const [showTemplates, setShowTemplates] = useState(false);

  const applyTemplate = (t: Partial<Draft>) => {
    setDraft({ ...draft, ...t });
    setShowTemplates(false);
  };

  return (
    <div>
      <div className="flex items-start justify-between mb-1">
        <h2 className="text-xl font-serif text-brand-dark">Skriv meddelandet</h2>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="inline-flex items-center gap-1.5 text-xs text-brand-muted hover:text-brand-dark px-2 py-1 border border-gray-200 rounded"
        >
          <Sparkles className="w-3 h-3" /> Mall
        </button>
      </div>
      <p className="text-sm text-brand-muted mb-4">
        {draft.type === 'EMAIL'
          ? 'Fyll i rubrik och innehåll. Fälten byggs ihop till ett rent veckobrev.'
          : 'Skriv ett kort sms. Använd {{name}} för att personifiera med förnamn.'}
      </p>

      {showTemplates && (
        <div className="mb-4 p-4 bg-white border border-gray-200 rounded-lg">
          <div className="text-xs text-brand-muted mb-3">
            Välj en färdig mall — du kan redigera precis som du vill efteråt.
          </div>
          <div className="grid grid-cols-2 gap-2">
            {(draft.type === 'EMAIL' ? EMAIL_TEMPLATES : SMS_TEMPLATES).map((t) => (
              <button
                key={t.id}
                onClick={() => draft.type === 'EMAIL'
                  ? applyTemplate((t as any).init)
                  : applyTemplate({ body: (t as any).text, useTemplate: false })}
                className="p-3 text-left bg-brand-bg hover:bg-gray-100 rounded-lg border border-gray-200 hover:border-brand-accent transition-colors"
              >
                <div className="font-semibold text-brand-dark text-sm">{t.name}</div>
                <div className="text-[11px] text-brand-muted mt-0.5">{(t as any).desc}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {draft.type === 'EMAIL' ? (
        <div className="space-y-4">
          <Field label="Rubrik">
            <InputWithEmoji
              value={draft.subject}
              onChange={(v) => setDraft({ ...draft, subject: v })}
              placeholder="Ex: Veckobrev — vecka 36 ✨"
            />
          </Field>
          <Field label="Inledning">
            <InputWithEmoji
              multiline rows={2}
              value={draft.intro}
              onChange={(v) => setDraft({ ...draft, intro: v })}
              placeholder="Ex: Hej alla, här kommer veckans uppdatering 💛"
            />
          </Field>
          <Field label="Veckans information">
            <InputWithEmoji
              multiline rows={4}
              value={draft.weekInfo}
              onChange={(v) => setDraft({ ...draft, weekInfo: v })}
              placeholder="Vad har hänt, vad händer? Kort och tydligt."
            />
          </Field>
          <Field label="Viktiga datum">
            <InputWithEmoji
              multiline rows={3}
              value={draft.keyDates}
              onChange={(v) => setDraft({ ...draft, keyDates: v })}
              placeholder="Ex: Måndag 8/9: personalmöte 16:00…"
            />
          </Field>
          <Field label="Avslutning">
            <InputWithEmoji
              multiline rows={2}
              value={draft.outro}
              onChange={(v) => setDraft({ ...draft, outro: v })}
              placeholder="Ex: Ha en fin vecka! /Mikaela 🌟"
            />
          </Field>
        </div>
      ) : (
        <div>
          <Field label="Meddelande">
            <InputWithEmoji
              multiline rows={8}
              value={draft.body}
              onChange={(v) => setDraft({ ...draft, body: v })}
              maxLength={918}
              placeholder="Hej {{name}}, …"
            />
          </Field>
          <SmsCounter text={draft.body} />
        </div>
      )}

      {/* Översättning för anställda som inte pratar svenska */}
      <TranslationBlock draft={draft} setDraft={setDraft} />

      <div className="mt-6 flex justify-between">
        <button onClick={onBack} className="text-sm text-brand-muted hover:text-brand-dark">← Tillbaka</button>
        <button
          onClick={onNext}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-dark/90"
        >
          Förhandsgranska <Eye className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

/** Extra språk-block — auto-översätter innehållet via AI. */
function TranslationBlock({ draft, setDraft }: { draft: Draft; setDraft: (d: Draft) => void }) {
  const [translating, setTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sourceText = draft.type === 'EMAIL'
    ? [draft.subject, draft.intro, draft.weekInfo && `Veckans information:\n${draft.weekInfo}`, draft.keyDates && `Viktiga datum:\n${draft.keyDates}`, draft.outro].filter(Boolean).join('\n\n')
    : draft.body;

  const translate = async () => {
    if (!draft.translatedLanguage || !sourceText.trim()) return;
    setTranslating(true);
    setError(null);
    try {
      const r = await fetch('/api/personalbrev-translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sourceText, targetLanguage: draft.translatedLanguage }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Översättning misslyckades');
      setDraft({ ...draft, translatedText: j.translated });
    } catch (e: any) { setError(e.message); }
    finally { setTranslating(false); }
  };

  return (
    <div className="mt-6 p-4 bg-brand-bg/40 border border-gray-200 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-brand-muted">Extra språk (valfritt)</span>
      </div>
      <p className="text-xs text-brand-muted mb-3">
        Många anställda pratar inte svenska. Välj språk så översätter AI:n automatiskt och bifogar översättningen i utskicket.
      </p>
      <div className="flex flex-wrap gap-2 mb-3">
        <button
          type="button"
          onClick={() => setDraft({ ...draft, translatedLanguage: null, translatedText: null })}
          className={`px-3 py-1.5 text-xs rounded-full border ${
            !draft.translatedLanguage ? 'bg-brand-dark text-white border-brand-dark' : 'bg-white text-brand-muted border-gray-200'
          }`}
        >
          Ingen översättning
        </button>
        {TRANSLATION_LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            onClick={() => setDraft({ ...draft, translatedLanguage: l.code, translatedText: null })}
            className={`px-3 py-1.5 text-xs rounded-full border inline-flex items-center gap-1 ${
              draft.translatedLanguage === l.code ? 'bg-brand-dark text-white border-brand-dark' : 'bg-white text-brand-dark border-gray-200 hover:border-brand-accent'
            }`}
          >
            <span>{l.flag}</span>{l.label}
          </button>
        ))}
      </div>
      {draft.translatedLanguage && (
        <>
          <div className="flex items-center gap-2 mb-2">
            <button
              type="button"
              onClick={translate}
              disabled={translating || !sourceText.trim()}
              className="text-xs px-3 py-1.5 bg-brand-accent text-white rounded hover:bg-brand-accent/90 disabled:opacity-50 inline-flex items-center gap-1.5"
            >
              {translating ? <Loader className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {draft.translatedText ? 'Översätt igen' : 'Översätt automatiskt'}
            </button>
            {draft.translatedText && <span className="text-[11px] text-emerald-600">✓ Översatt · redigera fritt nedan</span>}
          </div>
          {error && <div className="mb-2 p-2 text-xs bg-rose-50 border border-rose-200 rounded text-rose-800">{error}</div>}
          <textarea
            value={draft.translatedText || ''}
            onChange={(e) => setDraft({ ...draft, translatedText: e.target.value })}
            rows={8}
            placeholder="Översatt text visas här när du klickar på knappen…"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white outline-none focus:border-brand-accent"
          />
        </>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-brand-dark uppercase tracking-wider mb-1.5">{label}</label>
      {children}
    </div>
  );
}

function SmsCounter({ text }: { text: string }) {
  const len = text.length;
  const parts = len === 0 ? 0 : Math.ceil(len / 160);
  const nearMax = len > 800;
  return (
    <div className={`mt-2 flex items-center justify-between text-xs ${nearMax ? 'text-rose-600' : 'text-brand-muted'}`}>
      <span>{len} / 918 tecken · {parts} sms-del{parts === 1 ? '' : 'ar'}</span>
      {nearMax && <span className="inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Håll gärna kort och tydligt</span>}
    </div>
  );
}

// ─── STEG 4 — FÖRHANDSGRANSKNING + SKICKA ──────────────────────────────
function StepPreview({
  draft, setDraft, options, onBack, onSend,
}: {
  draft: Draft; setDraft: (d: Draft) => void; options: RecipientOptions | null;
  onBack: () => void; onSend: () => void;
}) {
  const [scheduleOpen, setScheduleOpen] = useState(!!draft.scheduledFor);

  const previewHtml = useMemo(() => {
    if (draft.type === 'EMAIL') return renderEmailPreview(draft);
    return renderSmsPreview(draft);
  }, [draft]);

  const recipientCount = draft.recipientIds.length;
  const recipientLabel = draft.recipientMode === 'ALL'
    ? 'All personal'
    : draft.recipientMode === 'TEAM' && options && draft.recipientTeamId
      ? options.teams.find((t) => t.id === draft.recipientTeamId)?.name || 'Avdelning'
      : `${recipientCount} valda personer`;

  return (
    <div>
      <h2 className="text-xl font-serif text-brand-dark mb-1">Förhandsgranska</h2>
      <p className="text-sm text-brand-muted mb-4">Så här kommer det se ut för mottagaren.</p>

      <div className="bg-white rounded-xl border border-gray-200 p-1 mb-4">
        <div className="px-4 py-2 border-b border-gray-100 text-xs text-brand-muted flex items-center justify-between">
          <span>Till: <strong className="text-brand-dark">{recipientLabel}</strong> ({recipientCount} mottagare)</span>
          <span>{draft.type === 'EMAIL' ? 'E-post' : 'SMS'}</span>
        </div>
        <div className="p-4" dangerouslySetInnerHTML={{ __html: previewHtml }} />
      </div>

      {/* Schemalägg */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={scheduleOpen}
            onChange={(e) => {
              setScheduleOpen(e.target.checked);
              if (!e.target.checked) setDraft({ ...draft, scheduledFor: null });
            }}
          />
          <Clock className="w-4 h-4 text-brand-muted" />
          Schemalägg utskicket
        </label>
        {scheduleOpen && (
          <input
            type="datetime-local"
            value={draft.scheduledFor ? draft.scheduledFor.slice(0, 16) : ''}
            onChange={(e) => setDraft({ ...draft, scheduledFor: e.target.value ? new Date(e.target.value).toISOString() : null })}
            className="mt-3 px-3 py-2 border border-gray-200 rounded text-sm"
          />
        )}
      </div>

      <div className="flex justify-between items-center">
        <button onClick={onBack} className="text-sm text-brand-muted hover:text-brand-dark">← Redigera</button>
        <button
          onClick={onSend}
          disabled={recipientCount === 0}
          className="inline-flex items-center gap-2 px-6 py-3 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="w-4 h-4" />
          {scheduleOpen && draft.scheduledFor ? 'Schemalägg' : 'Skicka nu'}
        </button>
      </div>
    </div>
  );
}

// ─── BEKRÄFTELSE-DIALOG ────────────────────────────────────────────────
function ConfirmDialog({
  draft, resolvedCount, sending, onCancel, onConfirm,
}: { draft: Draft; resolvedCount: number; sending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const missingContent = draft.type === 'EMAIL'
    ? !draft.subject && !draft.intro && !draft.weekInfo && !draft.keyDates && !draft.body
    : !draft.body;
  const missingRecipients = resolvedCount === 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="text-lg font-serif text-brand-dark">Redo att skicka?</h3>
            <p className="text-sm text-brand-muted mt-1">
              {draft.scheduledFor
                ? `Schemaläggs till ${new Date(draft.scheduledFor).toLocaleString('sv-SE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                : `Skickas direkt till ${resolvedCount} mottagare.`}
            </p>
          </div>
          <button onClick={onCancel} className="text-brand-muted hover:text-brand-dark">
            <X className="w-5 h-5" />
          </button>
        </div>

        {(missingContent || missingRecipients) && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
            <div className="flex gap-2">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <div>
                {missingRecipients && <div>Inga mottagare valda.</div>}
                {missingContent && <div>Meddelandet är tomt.</div>}
              </div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="px-4 py-2 text-sm text-brand-muted hover:text-brand-dark">
            Avbryt
          </button>
          <button
            onClick={onConfirm}
            disabled={sending || missingContent || missingRecipients}
            className="inline-flex items-center gap-2 px-5 py-2 bg-brand-dark text-white rounded-lg text-sm font-semibold hover:bg-brand-dark/90 disabled:opacity-50"
          >
            {sending && <Loader className="w-4 h-4 animate-spin" />}
            Ja, skicka
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────────
function toBody(d: Draft) {
  return {
    type: d.type,
    title: d.title || null,
    subject: d.subject || null,
    intro: d.intro || null,
    weekInfo: d.weekInfo || null,
    keyDates: d.keyDates || null,
    outro: d.outro || null,
    body: d.body || null,
    recipients: d.recipientIds,
    recipientMode: d.recipientMode,
    recipientTeamId: d.recipientTeamId,
    scheduledFor: d.scheduledFor,
    translatedLanguage: d.translatedLanguage,
    translatedText: d.translatedText,
  };
}

function esc(s: string): string { return (s || '').replace(/</g, '&lt;').replace(/\n/g, '<br/>'); }

function renderEmailPreview(d: Draft): string {
  const svenskt = d.body && !d.intro && !d.weekInfo && !d.keyDates && !d.outro
    ? `<div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.55;">${esc(d.body)}</div>`
    : `<div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.6;">
    ${d.subject ? `<h1 style="font-family:'Playfair Display',Georgia,serif;font-size:24px;margin:0 0 16px;">${esc(d.subject)}</h1>` : ''}
    ${d.intro ? `<p style="margin:0 0 12px;">${esc(d.intro)}</p>` : ''}
    ${d.weekInfo ? `<div style="margin:0 0 14px;padding:12px 16px;background:#faf7ee;border-left:3px solid #c9a96e;"><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:4px;">Veckans information</div>${esc(d.weekInfo)}</div>` : ''}
    ${d.keyDates ? `<div style="margin:0 0 14px;padding:12px 16px;background:#f5f3ee;border-radius:6px;"><div style="font-size:10px;letter-spacing:0.14em;text-transform:uppercase;color:#a68a4e;font-weight:700;margin-bottom:4px;">Viktiga datum</div>${esc(d.keyDates)}</div>` : ''}
    ${d.outro ? `<p style="margin:12px 0 0;">${esc(d.outro)}</p>` : ''}
  </div>`;

  if (d.translatedLanguage && d.translatedText?.trim()) {
    const lang = TRANSLATION_LANGUAGES.find((l) => l.code === d.translatedLanguage);
    return `${svenskt}
      <hr style="margin:24px 0;border:none;border-top:1px dashed #c9a96e;" />
      <div style="font-size:11px;color:#8b8578;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:8px;">${lang?.flag || ''} ${lang?.label || d.translatedLanguage}</div>
      <div style="font-family:Inter,Arial,sans-serif;color:#1a1a2e;line-height:1.55;white-space:pre-wrap;">${esc(d.translatedText)}</div>`;
  }
  return svenskt;
}

function renderSmsPreview(d: Draft): string {
  const svenskt = d.body || [d.subject, d.intro, d.weekInfo, d.keyDates, d.outro].filter(Boolean).join('\n\n');
  const combined = d.translatedText?.trim()
    ? `${svenskt}\n---\n${d.translatedText}`
    : svenskt;
  return `<div style="max-width:280px;margin:0 auto;padding:14px 18px;background:#f0f0f0;border-radius:18px;font-family:-apple-system,'SF Pro Text',sans-serif;font-size:14px;line-height:1.4;color:#000;white-space:pre-wrap;">${esc(combined) || '<em style="color:#999;">Inget meddelande ännu</em>'}</div>`;
}
