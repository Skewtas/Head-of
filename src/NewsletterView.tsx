import React, { useState, useRef, useCallback } from 'react';
import {
  Newspaper,
  Upload,
  X,
  Plus,
  Send,
  Image as ImageIcon,
  Eye,
  Clock,
  CheckCircle,
  AlertCircle,
  BarChart2,
  Bell,
  Trash2,
  RefreshCw,
  Type,
  AlignLeft,
  Link2,
  MoveUp,
  MoveDown,
  GripVertical,
  Bold,
  Italic,
  Smartphone,
  Mail
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

const CardHeader = ({ title, icon: Icon, action }: { title: string; icon?: any; action?: React.ReactNode }) => (
  <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between bg-white">
    <div className="flex items-center gap-2.5">
      {Icon && <Icon className="w-5 h-5 text-brand-dark" />}
      <h3 className="font-serif text-xl text-brand-dark tracking-tight">{title}</h3>
    </div>
    {action && <div>{action}</div>}
  </div>
);

const CardContent = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("p-6", className)}>
    {children}
  </div>
);

// --- Block types for the editor ---
type BlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'canva';

interface EditorBlock {
  id: string;
  type: BlockType;
  content: string;
  imageData?: string;
  buttonUrl?: string;
  buttonColor?: string;
}

interface SentNewsletter {
  id: string;
  subject: string;
  recipients: string[];
  openedBy: string[];
  clickedBy?: string[];
  sentAt: string;
  status: 'sent' | 'partial' | 'failed';
  category: string;
  successCount: number;
  failedCount: number;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export default function NewsletterView() {
  // Editor blocks
  const [blocks, setBlocks] = useState<EditorBlock[]>([
    { id: generateId(), type: 'heading', content: '' },
    { id: generateId(), type: 'text', content: '' },
  ]);

  // Newsletter content
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('Allmänt');

  // Channel: email, sms, or both
  type SendChannel = 'email' | 'sms' | 'both';
  const [sendChannel, setSendChannel] = useState<SendChannel>('email');
  const [smsMessage, setSmsMessage] = useState('');
  const [includeOptOutLink, setIncludeOptOutLink] = useState(false);

  // Recipients
  const [recipients, setRecipients] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [bulkInput, setBulkInput] = useState('');
  const [showBulkInput, setShowBulkInput] = useState(false);

  // State
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);
  const [sentHistory, setSentHistory] = useState<SentNewsletter[]>([]);
  const [isFetchingHistory, setIsFetchingHistory] = useState(false);
  const [isLoadingCustomers, setIsLoadingCustomers] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [allCustomers, setAllCustomers] = useState<any[]>([]);
  const [segments, setSegments] = useState<{
    areas: { name: string; count: number }[];
    clientTypes: { name: string; count: number }[];
    serviceTypes?: { name: string; count: number }[];
  }>({ areas: [], clientTypes: [] });
  const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([]);

  // Computed: customers with phone numbers for SMS sending who haven't opted out
  const smsRecipients = React.useMemo(() => {
    const list: any[] = [];
    recipients.forEach(r => {
      if (!r.includes('@') && r.match(/\d+/)) {
        list.push({ name: 'Manuell', phone: r, email: `${r.replace(/\s+/g, '')}@manuell.se` });
      } else {
        const c = allCustomers.find((cu: any) => cu.email === r);
        if (c && c.phone && !c.optedOutSms) list.push(c);
      }
    });
    const unique = new Map();
    list.forEach(c => unique.set(c.phone.replace(/[^0-9+]/g, ''), c));
    return Array.from(unique.values());
  }, [recipients, allCustomers]);

  const emailRecipients = React.useMemo(() => {
    const list: any[] = [];
    recipients.forEach(r => {
      if (r.includes('@') && !r.includes('@no-email.stodona.se') && !r.includes('@manuell.se')) {
        const c = allCustomers.find((cu: any) => cu.email === r);
        if (!c || !c.optedOutEmail) {
          list.push(r);
        }
      }
    });
    return list;
  }, [recipients, allCustomers]);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeImageBlockRef = useRef<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setIsFetchingHistory(true);
    try {
      const res = await fetch('/api/newsletter/history');
      if (res.ok) setSentHistory(await res.json());
    } catch (err) {
      console.error("Failed to fetch history:", err);
    } finally {
      setIsFetchingHistory(false);
    }
  }, []);

  const [hasLoadedBase, setHasLoadedBase] = useState(false);

  React.useEffect(() => { 
    fetchHistory(); 
    if (!hasLoadedBase) {
      importCustomers(false);
      setHasLoadedBase(true);
    }
  }, [fetchHistory, hasLoadedBase]);

  // --- Block operations ---
  const updateBlock = (id: string, updates: Partial<EditorBlock>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  };

  const removeBlock = (id: string) => {
    setBlocks(prev => prev.filter(b => b.id !== id));
  };

  const addBlock = (type: BlockType, afterId?: string) => {
    const newBlock: EditorBlock = {
      id: generateId(),
      type,
      content: type === 'divider' ? '' : '',
      buttonColor: type === 'button' ? '#1a1a2e' : undefined,
    };
    if (afterId) {
      setBlocks(prev => {
        const idx = prev.findIndex(b => b.id === afterId);
        const next = [...prev];
        next.splice(idx + 1, 0, newBlock);
        return next;
      });
    } else {
      setBlocks(prev => [...prev, newBlock]);
    }
  };

  const moveBlock = (id: string, direction: 'up' | 'down') => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (direction === 'up' && idx > 0) {
        const next = [...prev];
        [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
        return next;
      }
      if (direction === 'down' && idx < prev.length - 1) {
        const next = [...prev];
        [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
        return next;
      }
      return prev;
    });
  };

  // --- Image upload ---
  const handleFileSelect = (file: File, blockId: string) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      updateBlock(blockId, { imageData: e.target?.result as string, content: file.name });
    };
    reader.readAsDataURL(file);
  };

  // --- Recipients ---
  const addRecipient = (value: string) => {
    const trimmed = value.trim().toLowerCase();
    if (trimmed && !recipients.includes(trimmed)) {
      setRecipients(prev => [...prev, trimmed]);
    }
  };

  const handleBulkAdd = async () => {
    const items = bulkInput.split(/[,;\n]+/).map(e => e.trim().toLowerCase()).filter(e => e);
    if (items.length === 0) return;
    
    setIsLoadingCustomers(true);
    try {
      const newContacts = items.map(v => {
        if (v.includes('@')) return { email: v, name: 'Manuell', phone: '' };
        return { email: `${v.replace(/\s+/g,'')}@manuell.se`, name: 'Manuell', phone: v };
      });
      await fetch('/api/newsletter/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: newContacts })
      });
      setRecipients(prev => [...new Set([...prev, ...items])]);
      setBulkInput('');
      setShowBulkInput(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingCustomers(false);
    }
  };

  const handleAddSingleRecipient = async () => {
    const trimmed = emailInput.trim().toLowerCase();
    if (!trimmed) return;
    setIsLoadingCustomers(true);
    try {
      const contactData = trimmed.includes('@') 
        ? { email: trimmed, name: 'Manuell', phone: '' }
        : { email: `${trimmed.replace(/\s+/g,'')}@manuell.se`, name: 'Manuell', phone: trimmed };
      await fetch('/api/newsletter/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contacts: [contactData] })
      });
      addRecipient(trimmed);
      setEmailInput('');
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingCustomers(false);
    }
  };

  const importCustomers = async (sync = false) => {
    setIsLoadingCustomers(true);
    try {
      const res = await fetch(`/api/newsletter/customers${sync ? '?sync=true' : ''}`);
      if (res.ok) {
        const data = await res.json();
        setAllCustomers(data.customers);
        setSegments(data.segments || { areas: [], clientTypes: [] });

        if (sync) {
          setSendResult({ success: true, message: `Synkroniserade ${data.total} kunder från Timewave!` });
        }
      }
    } catch (err) {
      if (sync) setSendResult({ success: false, message: 'Kunde inte synkronisera med Timewave.' });
    } finally {
      setIsLoadingCustomers(false);
    }
  };

  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  // Apply segment filters
  const applySegments = () => {
    let filtered = allCustomers;
    if (selectedAreas.length > 0) {
      filtered = filtered.filter(c => selectedAreas.includes(c.area));
    }
    if (selectedTypes.length > 0) {
      filtered = filtered.filter(c => selectedTypes.includes(c.clientType));
    }
    if (selectedServices.length > 0) {
      filtered = filtered.filter(c => c.serviceTypes?.some((s: string) => selectedServices.includes(s)));
    }
    const emails = filtered.map((c: any) => c.email);
    setRecipients([...new Set(emails)]);
    setSendResult({ success: true, message: `${emails.length} mottagare valda baserat på dina filter.` });
  };

  const toggleArea = (area: string) => {
    setSelectedAreas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]);
  };
  const toggleType = (type: string) => {
    setSelectedTypes(prev => prev.includes(type) ? prev.filter(t => t !== type) : [...prev, type]);
  };
  const toggleService = (svc: string) => {
    setSelectedServices(prev => prev.includes(svc) ? prev.filter(s => s !== svc) : [...prev, svc]);
  };

  // --- Build HTML from blocks ---
  const buildHtmlFromBlocks = (): string => {
    let bodyContent = '';
    for (const block of blocks) {
      switch (block.type) {
        case 'heading':
          if (block.content) {
            bodyContent += `<div style="padding:0 32px;"><h2 style="margin:0 0 16px;font-size:24px;font-weight:300;color:#1a1a2e;letter-spacing:-0.3px;">${block.content}</h2></div>`;
          }
          break;
        case 'text':
          if (block.content) {
            bodyContent += `<div style="padding:0 32px;"><p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#444;">${block.content.replace(/\n/g, '<br/>')}</p></div>`;
          }
          break;
        case 'image':
          if (block.imageData) {
            const imgTag = `<img src="${block.imageData}" alt="${block.content || 'Bild'}" style="width:100%;max-width:536px;height:auto;border-radius:10px;display:block;margin:0 auto;" />`;
            const contentLinked = block.buttonUrl 
              ? `<a href="${block.buttonUrl}" target="_blank" style="display:block;text-decoration:none;">${imgTag}</a>` 
              : imgTag;
            bodyContent += `<div style="padding:0 32px;margin:0 0 20px;">${contentLinked}</div>`;
          }
          break;
        case 'canva':
          if (block.imageData) {
            const imgTag = `<img src="${block.imageData}" alt="Canva Design" style="width:100%;height:auto;display:block;margin:0;padding:0;" />`;
            const contentLinked = block.buttonUrl 
              ? `<a href="${block.buttonUrl}" target="_blank" style="display:block;text-decoration:none;">${imgTag}</a>` 
              : imgTag;
            bodyContent += `<div style="margin:0 0 20px;">${contentLinked}</div>`;
          }
          break;
        case 'button':
          if (block.content && block.buttonUrl) {
            bodyContent += `<div style="padding:0 32px;text-align:center;margin:24px 0;"><a href="${block.buttonUrl}" target="_blank" style="display:inline-block;padding:14px 36px;background:${block.buttonColor || '#1a1a2e'};color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.5px;">${block.content}</a></div>`;
          }
          break;
        case 'divider':
          bodyContent += `<div style="padding:0 32px;"><hr style="border:none;border-top:1px solid #eae4d9;margin:24px 0;" /></div>`;
          break;
      }
    }
    return bodyContent;
  };

  // --- Send ---
  const handleSend = async () => {
    if (recipients.length === 0) {
      setSendResult({ success: false, message: 'Lägg till minst en mottagare.' });
      return;
    }

    const willSendEmail = sendChannel === 'email' || sendChannel === 'both';
    const willSendSms = sendChannel === 'sms' || sendChannel === 'both';

    if (willSendEmail) {
      if (!subject.trim()) {
        setSendResult({ success: false, message: 'Ange en ämnesrad för e-post.' });
        return;
      }
      if (blocks.every(b => !b.content && !b.imageData)) {
        setSendResult({ success: false, message: 'Nyhetsbrevet har inget innehåll.' });
        return;
      }
      if (emailRecipients.length === 0) {
        setSendResult({ success: false, message: 'Inga valda mottagare har e-postadress.' });
        return;
      }
    }

    if (willSendSms && !smsMessage.trim()) {
      setSendResult({ success: false, message: 'Skriv ett SMS-meddelande.' });
      return;
    }

    if (willSendSms && smsRecipients.length === 0) {
      setSendResult({ success: false, message: 'Inga valda mottagare har telefonnummer.' });
      return;
    }

    setIsSending(true);
    setSendResult(null);
    const results: string[] = [];

    try {
      // Send email
      if (willSendEmail) {
        const htmlContent = buildHtmlFromBlocks();
        const res = await fetch('/api/newsletter/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            subject,
            introText: '',
            embedUrl: null,
            imageData: null,
            htmlContent,
            recipients: emailRecipients,
            category
          })
        });
        const data = await res.json();
        results.push(res.ok ? `📧 ${data.message}` : `📧 Fel: ${data.error}`);
      }

      // Send SMS
      if (willSendSms) {
        const smsRes = await fetch('/api/newsletter/sms', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: smsMessage,
            recipients: smsRecipients.map((c: any) => ({ name: c.name, phone: c.phone, email: c.email })),
            includeOptOutLink
          })
        });
        const smsData = await smsRes.json();
        results.push(smsRes.ok ? `📱 ${smsData.message}` : `📱 Fel: ${smsData.error}`);
      }

      const allOk = results.every(r => !r.includes('Fel:'));
      setSendResult({ success: allOk, message: results.join(' | ') });

      if (allOk) {
        setSubject('');
        setSmsMessage('');
        setBlocks([
          { id: generateId(), type: 'heading', content: '' },
          { id: generateId(), type: 'text', content: '' },
        ]);
        setRecipients([]);
        fetchHistory();
      }
    } catch (err) {
      setSendResult({ success: false, message: 'Kunde inte nå servern.' });
    } finally {
      setIsSending(false);
    }
  };

  const handleResend = async (id: string, originalSubject: string) => {
    const newSubject = window.prompt("Ange ämnesrad för påminnelsen:", `Påminnelse: ${originalSubject}`);
    if (newSubject === null) return;

    setIsSending(true);
    setSendResult(null);
    try {
      const res = await fetch(`/api/newsletter/${id}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newSubject })
      });
      const data = await res.json();
      if (res.ok) {
        setSendResult({ success: true, message: data.message });
        fetchHistory();
      } else {
        setSendResult({ success: false, message: data.error || 'Fel vid påminnelse.' });
      }
    } catch (err) {
      setSendResult({ success: false, message: 'Kunde inte nå servern.' });
    } finally {
      setIsSending(false);
    }
  };

  // --- Render block editor ---
  const renderBlockEditor = (block: EditorBlock, index: number) => (
    <div key={block.id} className="group relative border border-gray-100 rounded-xl bg-white hover:border-gray-200 transition-all">
      {/* Block toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-50 bg-gray-50/50 rounded-t-xl">
        <div className="flex items-center gap-1.5">
          <GripVertical className="w-3.5 h-3.5 text-gray-300" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {block.type === 'heading' ? 'Rubrik' :
             block.type === 'text' ? 'Text' :
             block.type === 'image' ? 'Bild' :
             block.type === 'button' ? 'Knapp' : 'Avdelare'}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => moveBlock(block.id, 'up')} disabled={index === 0} className="p-1 text-gray-400 hover:text-brand-dark disabled:opacity-30 transition-colors">
            <MoveUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => moveBlock(block.id, 'down')} disabled={index === blocks.length - 1} className="p-1 text-gray-400 hover:text-brand-dark disabled:opacity-30 transition-colors">
            <MoveDown className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => removeBlock(block.id)} className="p-1 text-gray-400 hover:text-red-500 transition-colors ml-1">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Block content */}
      <div className="p-3">
        {block.type === 'heading' && (
          <input
            type="text"
            value={block.content}
            onChange={(e) => updateBlock(block.id, { content: e.target.value })}
            placeholder="Skriv en rubrik..."
            className="w-full text-xl font-light text-brand-dark placeholder:text-gray-300 border-none outline-none bg-transparent"
          />
        )}

        {block.type === 'text' && (
          <textarea
            value={block.content}
            onChange={(e) => updateBlock(block.id, { content: e.target.value })}
            placeholder="Skriv brödtext här..."
            rows={4}
            className="w-full text-sm text-brand-dark placeholder:text-gray-300 border-none outline-none bg-transparent resize-none leading-relaxed"
          />
        )}

        {(block.type === 'image' || block.type === 'canva') && (
          <div>
            {block.imageData ? (
              <div className="relative space-y-2">
                <div className="relative">
                  {block.type === 'canva' && <div className="absolute top-2 left-2 px-2 py-1 bg-brand-dark text-white text-[10px] font-bold uppercase rounded z-10">Canva Helsidesbild</div>}
                  <img src={block.imageData} alt="" className={cn("w-full h-auto object-cover", block.type === 'canva' ? 'rounded-none' : 'rounded-lg max-h-[300px]')} />
                  <button
                    onClick={() => updateBlock(block.id, { imageData: undefined, content: '', buttonUrl: '' })}
                    className="absolute top-2 right-2 p-1.5 bg-white/90 rounded-lg shadow-sm hover:bg-red-50 transition-colors z-10"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-red-500" />
                  </button>
                </div>
                <input
                  type="url"
                  value={block.buttonUrl || ''}
                  onChange={(e) => updateBlock(block.id, { buttonUrl: e.target.value })}
                  placeholder="Länk (valfritt), t.ex. https://stodona.se/boka"
                  className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-brand-dark focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
                />
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center py-8 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-gray-300 hover:bg-gray-50/50 transition-all">
                <ImageIcon className="w-8 h-8 text-gray-300 mb-2" />
                <span className="text-sm text-gray-400">{block.type === 'canva' ? 'Ladda upp expoterad bild från Canva' : 'Klicka för att ladda upp bild'}</span>
                <span className="text-xs text-gray-300 mt-0.5">PNG, JPG, WebP</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file, block.id);
                  }}
                />
              </label>
            )}
          </div>
        )}

        {block.type === 'button' && (
          <div className="space-y-2">
            <input
              type="text"
              value={block.content}
              onChange={(e) => updateBlock(block.id, { content: e.target.value })}
              placeholder="Knapptext, t.ex. 'Boka nu'"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
            />
            <input
              type="url"
              value={block.buttonUrl || ''}
              onChange={(e) => updateBlock(block.id, { buttonUrl: e.target.value })}
              placeholder="https://stodona.se/boka"
              className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-brand-accent/30"
            />
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400">Färg:</span>
              <input
                type="color"
                value={block.buttonColor || '#1a1a2e'}
                onChange={(e) => updateBlock(block.id, { buttonColor: e.target.value })}
                className="w-6 h-6 rounded cursor-pointer border-0"
              />
              <div
                className="flex-1 py-1.5 rounded-lg text-center text-xs font-bold text-white"
                style={{ backgroundColor: block.buttonColor || '#1a1a2e' }}
              >
                {block.content || 'Förhandsvisning'}
              </div>
            </div>
          </div>
        )}

        {block.type === 'divider' && (
          <hr className="border-t border-gray-200 my-2" />
        )}
      </div>
    </div>
  );

  // --- Preview HTML ---
  const previewHtml = `
    <div style="max-width:600px;margin:0 auto;font-family:'Segoe UI',sans-serif;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.06);">
      <div style="padding:40px 32px 0;">
        <h1 style="margin:0 0 8px;font-size:28px;color:#1a1a2e;font-weight:300;">Stodona</h1>
        <div style="height:3px;width:40px;background:#c9a96e;margin-bottom:24px;"></div>
      </div>
      <div style="padding:0 32px 32px;">${buildHtmlFromBlocks()}</div>
      <div style="padding:24px 32px;background:#faf8f5;border-top:1px solid #eae4d9;text-align:center;">
        <p style="margin:0;font-size:12px;color:#999;">© ${new Date().getFullYear()} Stodona AB</p>
      </div>
    </div>`;

  const hasContent = blocks.some(b => b.content || b.imageData);

  return (
    <div className="p-8 bg-brand-bg min-h-[calc(100vh-64px)] space-y-6">
      {/* Channel Selector */}
      <Card>
        <CardContent className="flex items-center gap-3">
          <span className="text-xs font-bold uppercase tracking-wider text-gray-400 mr-2">Kanal:</span>
          {[
            { value: 'email' as SendChannel, icon: Mail, label: 'E-post' },
            { value: 'sms' as SendChannel, icon: Smartphone, label: 'SMS' },
            { value: 'both' as SendChannel, icon: Send, label: 'Båda' },
          ].map(ch => (
            <button
              key={ch.value}
              onClick={() => setSendChannel(ch.value)}
              className={cn(
                "flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all",
                sendChannel === ch.value
                  ? "bg-brand-dark text-white shadow-sm"
                  : "bg-gray-50 text-brand-muted border border-gray-200 hover:bg-gray-100"
              )}
            >
              <ch.icon className="w-4 h-4" />
              {ch.label}
            </button>
          ))}
          {sendChannel !== 'email' && (
            <div className="ml-auto text-xs text-brand-muted text-right leading-tight">
              📱 {smsRecipients.length} / {recipients.length} har mobilnummer<br/>
              <span className="text-[10px] opacity-70">(spärrade nummer är borträknade)</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* SMS Editor (shown when sms or both) */}
      {(sendChannel === 'sms' || sendChannel === 'both') && (
        <Card>
          <CardHeader title="SMS-meddelande" icon={Smartphone} />
          <CardContent className="space-y-3">
            <p className="text-xs text-brand-muted">
              Skriv ditt SMS nedan. Använd <code className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">{'{{name}}'}</code> för att personalisera med kundens förnamn.
            </p>
            <textarea
              value={smsMessage}
              onChange={e => setSmsMessage(e.target.value)}
              maxLength={918}
              rows={4}
              placeholder="Hej {{name}}! Vi vill berätta att..."
              className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent transition-all resize-none"
            />
            <div className="flex items-center justify-between">
              <span className={cn(
                "text-xs font-medium",
                smsMessage.length > 160 ? "text-amber-600" : "text-gray-400"
              )}>
                {smsMessage.length}/160 tecken
                {smsMessage.length > 160 && ` (${Math.ceil(smsMessage.length / 153)} SMS-delar)`}
              </span>
              <span className="text-xs text-gray-400">
                {smsMessage.length <= 160 ? '1 SMS' : `${Math.ceil(smsMessage.length / 153)} SMS`} per mottagare
              </span>
            </div>
            <label className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-100 cursor-pointer w-fit">
              <input 
                type="checkbox" 
                checked={includeOptOutLink} 
                onChange={(e) => setIncludeOptOutLink(e.target.checked)} 
                className="w-4 h-4 text-brand-dark rounded border-gray-300 focus:ring-brand-accent/30"
              />
              <span className="text-xs font-medium text-brand-dark">Skicka med avregistreringslänk (ca 45 tecken)</span>
            </label>
          </CardContent>
        </Card>
      )}

      {/* Editor + Preview */}
      {(sendChannel === 'email' || sendChannel === 'both') && (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Editor */}
        <Card>
          <CardHeader
            title="Skapa Nyhetsbrev"
            icon={Newspaper}
            action={
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                  showPreview ? "bg-brand-dark text-white" : "bg-gray-100 text-brand-muted hover:bg-gray-200"
                )}
              >
                <Eye className="w-3.5 h-3.5 inline mr-1" />
                {showPreview ? 'Dölj' : 'Visa'} förhandsgranskning
              </button>
            }
          />
          <CardContent className="space-y-3">
            {/* Subject + Category */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Ämnesrad *"
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent transition-all"
                />
              </div>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/20 transition-all"
              >
                <option value="Allmänt">Allmänt</option>
                <option value="Kampanj">Kampanj</option>
                <option value="Säsong">Säsongsnytt</option>
                <option value="Erbjudande">Erbjudande</option>
                <option value="Information">Information</option>
              </select>
            </div>

            {/* Blocks */}
            <div className="space-y-2">
              {blocks.map((block, i) => renderBlockEditor(block, i))}
            </div>

            {/* Add block buttons */}
            <div className="flex items-center gap-2 pt-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Lägg till:</span>
              <button type="button" onClick={() => addBlock('heading')} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-brand-muted hover:bg-gray-100 transition-colors">
                <Type className="w-3 h-3" /> Rubrik
              </button>
              <button type="button" onClick={() => addBlock('text')} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-brand-muted hover:bg-gray-100 transition-colors">
                <AlignLeft className="w-3 h-3" /> Text
              </button>
              <button type="button" onClick={() => addBlock('image')} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-brand-muted hover:bg-gray-100 transition-colors">
                <ImageIcon className="w-3 h-3" /> Bild
              </button>
              <button type="button" onClick={() => addBlock('button')} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-brand-muted hover:bg-gray-100 transition-colors">
                <Link2 className="w-3 h-3" /> Knapp
              </button>
              <button type="button" onClick={() => addBlock('canva')} className="flex items-center gap-1 px-2.5 py-1.5 bg-brand-accent/10 text-brand-dark border border-brand-accent/30 rounded-lg text-xs font-medium hover:bg-brand-accent/20 transition-colors">
                <ImageIcon className="w-3 h-3" /> Helsidesbild (Canva)
              </button>
              <button type="button" onClick={() => addBlock('divider')} className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-xs text-brand-muted hover:bg-gray-100 transition-colors">
                ─ Avdelare
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Preview / Recipients */}
        <div className="space-y-6">
          {showPreview && (
            <Card>
              <CardHeader title="Förhandsgranskning" icon={Eye} />
              <CardContent className="p-0">
                <div className="bg-[#f5f3ef] p-6">
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recipients */}
          <Card>
            <CardHeader
              title="Mottagare"
              icon={Send}
              action={
                <span className="bg-brand-bg text-brand-dark border border-brand-accent/20 text-xs font-bold px-2.5 py-1 rounded-full">
                  {recipients.length} st
                </span>
              }
            />
            <CardContent className="space-y-3">
              <button
                onClick={() => importCustomers(true)}
                disabled={isLoadingCustomers}
                className="w-full py-2.5 bg-brand-bg border border-brand-accent/20 text-brand-dark rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-brand-accent/10 transition-all flex items-center justify-center gap-2"
              >
                {isLoadingCustomers ? (
                  <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Hämtar & Synkroniserar...</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5" /> Synkronisera mot Timewave</>
                )}
              </button>

              {/* Segment selector */}
              {allCustomers.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 space-y-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Filtrera efter Område</div>
                    <div className="flex flex-wrap gap-1.5">
                      {segments.areas.map(area => (
                        <button
                          key={area.name}
                          onClick={() => toggleArea(area.name)}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                            selectedAreas.includes(area.name)
                              ? "bg-brand-dark text-white border-brand-dark"
                              : "bg-white text-brand-muted border-gray-200 hover:border-gray-300"
                          )}
                        >
                          {area.name} <span className="opacity-60">({area.count})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Filtrera efter Kundtyp</div>
                    <div className="flex flex-wrap gap-1.5">
                      {segments.clientTypes.map(type => (
                        <button
                          key={type.name}
                          onClick={() => toggleType(type.name)}
                          className={cn(
                            "px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                            selectedTypes.includes(type.name)
                              ? "bg-brand-dark text-white border-brand-dark"
                              : "bg-white text-brand-muted border-gray-200 hover:border-gray-300"
                          )}
                        >
                          {type.name} <span className="opacity-60">({type.count})</span>
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Service Types */}
                  {segments.serviceTypes && segments.serviceTypes.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-2">Filtrera efter Tjänstetyp</div>
                      <div className="flex flex-wrap gap-1.5">
                        {segments.serviceTypes.map(type => (
                          <button
                            key={type.name}
                            onClick={() => toggleService(type.name)}
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-xs font-medium transition-all border",
                              selectedServices.includes(type.name)
                                ? "bg-brand-dark text-white border-brand-dark"
                                : "bg-white text-brand-muted border-gray-200 hover:border-gray-300"
                            )}
                          >
                            {type.name} <span className="opacity-60">({type.count})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(selectedAreas.length > 0 || selectedTypes.length > 0 || selectedServices.length > 0) && (
                    <div className="flex items-center gap-2 mt-4 pt-2 border-t border-gray-200">
                      <button
                        onClick={applySegments}
                        className="px-4 py-2 bg-brand-dark text-white rounded-lg text-xs font-bold uppercase tracking-wider hover:bg-brand-accent transition-colors"
                      >
                        Tillämpa filter
                      </button>
                      <button
                        onClick={() => { setSelectedAreas([]); setSelectedTypes([]); setSelectedServices([]); }}
                        className="text-xs text-gray-400 hover:text-red-500"
                      >
                        Rensa filter
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <input
                  type="text"
                  value={emailInput}
                  onChange={(e) => setEmailInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); handleAddSingleRecipient(); }
                  }}
                  placeholder="namn@exempel.se eller 070..."
                  className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/20 transition-all"
                />
                <button
                  onClick={handleAddSingleRecipient}
                  className="px-3 py-2 bg-brand-dark text-white rounded-xl hover:bg-brand-accent transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              <button
                onClick={() => setShowBulkInput(!showBulkInput)}
                className="text-xs text-brand-dark hover:text-brand-accent font-medium"
              >
                {showBulkInput ? 'Dölj' : 'Klistra in flera mottagare'}
              </button>

              {showBulkInput && (
                <div className="space-y-2">
                  <textarea
                    value={bulkInput}
                    onChange={(e) => setBulkInput(e.target.value)}
                    placeholder="e-postadresser eller telefonnummer separerade med komma, ny rad..."
                    rows={3}
                    className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/20 resize-none"
                  />
                  <button onClick={handleBulkAdd} className="px-4 py-2 bg-gray-100 text-brand-muted rounded-lg text-xs font-medium hover:bg-gray-200">
                    Lägg till alla
                  </button>
                </div>
              )}

              {recipients.length > 0 && (
                <div className="flex flex-wrap gap-1.5 max-h-[120px] overflow-y-auto">
                  {recipients.map((email) => (
                    <span key={email} className="inline-flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded-lg text-[11px] text-brand-muted">
                      {email}
                      <button onClick={() => setRecipients(prev => prev.filter(e => e !== email))} className="text-gray-400 hover:text-red-500">
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              {recipients.length > 0 && (
                <button onClick={() => setRecipients([])} className="text-xs text-gray-400 hover:text-red-500 font-medium flex items-center gap-1">
                  <Trash2 className="w-3 h-3" /> Rensa alla
                </button>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      )}

      {/* Send Section */}
      <Card>
        <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4 text-sm text-brand-muted">
            <span className={cn("flex items-center gap-1.5", hasContent ? "text-emerald-600" : "text-gray-400")}>
              {hasContent ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              Innehåll
            </span>
            <span className={cn("flex items-center gap-1.5", subject.trim() ? "text-emerald-600" : "text-gray-400")}>
              {subject.trim() ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              Ämne
            </span>
            <span className={cn("flex items-center gap-1.5", recipients.length > 0 ? "text-emerald-600" : "text-gray-400")}>
              {recipients.length > 0 ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {sendChannel === 'sms' ? smsRecipients.length : sendChannel === 'both' ? Math.max(emailRecipients.length, smsRecipients.length) : emailRecipients.length} mottagare
            </span>
          </div>
          <button
            onClick={handleSend}
            disabled={isSending}
            className={cn(
              "px-8 py-3 rounded-xl text-sm font-bold uppercase tracking-widest transition-all duration-300 shadow-sm",
              isSending
                ? "bg-gray-200 text-gray-400 cursor-not-allowed"
                : "bg-brand-dark text-white hover:bg-brand-accent hover:-translate-y-0.5 hover:shadow-md"
            )}
          >
            {isSending ? (
              <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Skickar...</span>
            ) : (
              <span className="flex items-center gap-2"><Send className="w-4 h-4" /> Skicka Nyhetsbrev</span>
            )}
          </button>
        </CardContent>
      </Card>

      {/* Send Result */}
      {sendResult && (
        <div className={cn(
          "rounded-xl p-4 text-sm font-medium flex items-center gap-2",
          sendResult.success
            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
            : "bg-red-50 text-red-700 border border-red-200"
        )}>
          {sendResult.success ? <CheckCircle className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
          {sendResult.message}
        </div>
      )}

      {/* History */}
      {sentHistory.length > 0 && (
        <Card>
          <CardHeader
            title="Skickade Nyhetsbrev"
            icon={Clock}
            action={
              <button onClick={fetchHistory} disabled={isFetchingHistory} className="text-gray-400 hover:text-brand-muted transition-colors">
                <RefreshCw className={cn("w-4 h-4", isFetchingHistory && "animate-spin")} />
              </button>
            }
          />
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-brand-muted uppercase bg-gray-50">
                <tr>
                  <th className="px-5 py-3">Ämne</th>
                  <th className="px-5 py-3 text-center">Kategori</th>
                  <th className="px-5 py-3 text-center">Öppningsfrekvens</th>
                  <th className="px-5 py-3 text-center">Klick</th>
                  <th className="px-5 py-3">Tidpunkt</th>
                  <th className="px-5 py-3 text-right">Åtgärd</th>
                </tr>
              </thead>
              <tbody>
                {sentHistory.map((item) => {
                  const recipientCount = item.recipients.length;
                  const openedCount = item.openedBy.length;
                  const openRate = recipientCount > 0 ? Math.round((openedCount / recipientCount) * 100) : 0;
                  const clickedCount = item.clickedBy?.length || 0;
                  const clickRate = openedCount > 0 ? Math.round((clickedCount / openedCount) * 100) : 0;
                  const unopenedCount = recipientCount - openedCount;

                  return (
                    <tr key={item.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                      <td className="px-5 py-4 font-medium text-brand-dark">{item.subject}</td>
                      <td className="px-5 py-4 text-center">
                        <span className="px-2 py-0.5 bg-gray-100 text-brand-muted rounded-full text-xs font-medium">
                          {item.category || 'Allmänt'}
                        </span>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-1.5 mb-1">
                            <BarChart2 className="w-4 h-4 text-emerald-500" />
                            <span className="font-bold text-brand-muted">{openRate}%</span>
                            <span className="text-xs text-gray-400">({openedCount}/{recipientCount})</span>
                          </div>
                          <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-400 transition-all" style={{ width: `${openRate}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col items-center">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Link2 className="w-3.5 h-3.5 text-brand-accent" />
                            <span className="font-bold text-brand-muted">{clickRate}%</span>
                            <span className="text-xs text-gray-400">({clickedCount} st)</span>
                          </div>
                          <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-accent transition-all" style={{ width: `${clickRate}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-brand-muted text-xs">{item.sentAt}</td>
                      <td className="px-5 py-4 text-right">
                        {unopenedCount > 0 ? (
                          <button
                            onClick={() => handleResend(item.id, item.subject)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-brand-bg text-brand-dark hover:bg-brand-accent hover:text-white font-medium rounded-lg text-xs transition-colors"
                          >
                            <Bell className="w-3.5 h-3.5" /> Påminnelse ({unopenedCount})
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-50 text-gray-400 rounded-md text-xs font-medium">
                            <CheckCircle className="w-3.5 h-3.5" /> Alla har öppnat
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
