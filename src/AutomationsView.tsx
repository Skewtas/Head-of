import React, { useState, useCallback, useEffect } from 'react';
import {
  Zap,
  Eye,
  CheckCircle,
  AlertCircle,
  Trash2,
  RefreshCw,
  Type,
  AlignLeft,
  Link2,
  MoveUp,
  MoveDown,
  GripVertical,
  Image as ImageIcon
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

type BlockType = 'heading' | 'text' | 'image' | 'button' | 'divider' | 'canva';

interface EditorBlock {
  id: string;
  type: BlockType;
  content: string;
  imageData?: string;
  buttonUrl?: string;
  buttonColor?: string;
}

const generateId = () => Math.random().toString(36).substring(2, 9);

export default function AutomationsView() {
  const [activeTemplate, setActiveTemplate] = useState<'welcome' | 'birthday'>('welcome');
  const [subject, setSubject] = useState('');
  const [blocks, setBlocks] = useState<EditorBlock[]>([
    { id: generateId(), type: 'heading', content: 'Välkommen Vännen!' },
    { id: generateId(), type: 'text', content: 'Det här är en startmall.' },
  ]);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [showPreview, setShowPreview] = useState(false);

  // Load template from DB when switching tabs
  const loadTemplate = useCallback(async (templateId: string) => {
    setIsLoading(true);
    setSaveResult(null);
    try {
      const res = await fetch('/api/automations/templates');
      if (res.ok) {
        const templates = await res.json();
        const t = templates.find((x: any) => x.id === templateId);
        if (t) {
          setSubject(t.subject);
          setBlocks(typeof t.blocks === 'string' ? JSON.parse(t.blocks) : t.blocks);
        } else {
          // Default empty state
          setSubject('');
          setBlocks([
            { id: generateId(), type: 'heading', content: templateId === 'welcome' ? 'Välkommen till oss!' : 'Grattis på födelsedagen!' },
            { id: generateId(), type: 'text', content: '' },
          ]);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplate(activeTemplate);
  }, [activeTemplate, loadTemplate]);

  // --- Block operations ---
  const updateBlock = (id: string, updates: Partial<EditorBlock>) => {
    setBlocks(prev => prev.map(b => b.id === id ? { ...b, ...updates } : b));
  };
  const removeBlock = (id: string) => setBlocks(prev => prev.filter(b => b.id !== id));
  const addBlock = (type: BlockType) => {
    setBlocks(prev => [...prev, {
      id: generateId(), type, content: type === 'divider' ? '' : '', buttonColor: type === 'button' ? '#1a1a2e' : undefined,
    }]);
  };
  const moveBlock = (id: string, direction: 'up' | 'down') => {
    setBlocks(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (direction === 'up' && idx > 0) {
        const next = [...prev]; [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]; return next;
      }
      if (direction === 'down' && idx < prev.length - 1) {
        const next = [...prev]; [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]; return next;
      }
      return prev;
    });
  };

  const handleFileSelect = (file: File, blockId: string) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => updateBlock(blockId, { imageData: e.target?.result as string, content: file.name });
    reader.readAsDataURL(file);
  };

  // --- Save ---
  const handleSave = async () => {
    if (!subject.trim()) {
      setSaveResult({ success: false, message: 'Ange en ämnesrad.' });
      return;
    }
    setIsSaving(true);
    setSaveResult(null);

    try {
      const res = await fetch('/api/automations/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: activeTemplate,
          subject,
          blocks
        })
      });
      const data = await res.json();
      if (res.ok) {
        setSaveResult({ success: true, message: data.message });
      } else {
        setSaveResult({ success: false, message: data.error || 'Något gick fel.' });
      }
    } catch (err) {
      setSaveResult({ success: false, message: 'Kunde inte nå servern.' });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveResult(null), 5000); // clear msg after 5s
    }
  };

  // --- Render block editor ---
  const renderBlockEditor = (block: EditorBlock, index: number) => (
    <div key={block.id} className="group relative border border-gray-100 rounded-xl bg-white hover:border-gray-200 transition-all">
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-50 bg-gray-50/50 rounded-t-xl">
        <div className="flex items-center gap-1.5">
          <GripVertical className="w-3.5 h-3.5 text-gray-300" />
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">
            {block.type === 'heading' ? 'Rubrik' :
             block.type === 'text' ? 'Text' :
             block.type === 'image' ? 'Bild' :
             block.type === 'canva' ? 'Canva Bild' :
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
        {block.type === 'divider' && <hr className="border-t border-gray-200 my-2" />}
      </div>
    </div>
  );

  // --- Build HTML from blocks ---
  const buildHtmlFromBlocks = (): string => {
    let bodyContent = '';
    for (const block of blocks) {
      switch (block.type) {
        case 'heading':
          if (block.content) bodyContent += `<div style="padding:0 32px;"><h2 style="margin:0 0 16px;font-size:24px;font-weight:300;color:#1a1a2e;letter-spacing:-0.3px;">${block.content}</h2></div>`;
          break;
        case 'text':
          if (block.content) bodyContent += `<div style="padding:0 32px;"><p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#444;">${block.content.replace(/\n/g, '<br/>')}</p></div>`;
          break;
        case 'image':
          if (block.imageData) {
            const imgTag = `<img src="${block.imageData}" alt="${block.content || 'Bild'}" style="width:100%;max-width:536px;height:auto;border-radius:10px;display:block;margin:0 auto;" />`;
            const contentLinked = block.buttonUrl ? `<a href="${block.buttonUrl}" target="_blank" style="display:block;text-decoration:none;">${imgTag}</a>` : imgTag;
            bodyContent += `<div style="padding:0 32px;margin:0 0 20px;">${contentLinked}</div>`;
          }
          break;
        case 'canva':
          if (block.imageData) {
            const imgTag = `<img src="${block.imageData}" alt="Canva Design" style="width:100%;height:auto;display:block;margin:0;padding:0;" />`;
            const contentLinked = block.buttonUrl ? `<a href="${block.buttonUrl}" target="_blank" style="display:block;text-decoration:none;">${imgTag}</a>` : imgTag;
            bodyContent += `<div style="margin:0 0 20px;">${contentLinked}</div>`;
          }
          break;
        case 'button':
          if (block.content && block.buttonUrl) bodyContent += `<div style="padding:0 32px;text-align:center;margin:24px 0;"><a href="${block.buttonUrl}" target="_blank" style="display:inline-block;padding:14px 36px;background:${block.buttonColor || '#1a1a2e'};color:#fff;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;letter-spacing:0.5px;">${block.content}</a></div>`;
          break;
        case 'divider':
          bodyContent += `<div style="padding:0 32px;"><hr style="border:none;border-top:1px solid #eae4d9;margin:24px 0;" /></div>`;
          break;
      }
    }
    return bodyContent;
  };

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-20 text-brand-muted">
        <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Laddar automationsmallar...
      </div>
    );
  }

  const hasContent = blocks.some(b => b.content || b.imageData);

  return (
    <div className="p-8 bg-brand-bg min-h-[calc(100vh-64px)] space-y-6">
      
      {/* Top Tabs */}
      <div className="flex items-center gap-4 bg-white p-2 border border-gray-100 rounded-xl w-max">
        <button
          onClick={() => setActiveTemplate('welcome')}
          className={cn(
            "px-6 py-2.5 rounded-lg text-sm font-bold tracking-wide uppercase transition-all",
            activeTemplate === 'welcome' 
              ? "bg-brand-dark text-white shadow-md" 
              : "text-brand-muted hover:bg-gray-50"
          )}
        >
          Välkomstmail
        </button>
        <button
          onClick={() => setActiveTemplate('birthday')}
          className={cn(
            "px-6 py-2.5 rounded-lg text-sm font-bold tracking-wide uppercase transition-all",
            activeTemplate === 'birthday' 
              ? "bg-brand-dark text-white shadow-md" 
              : "text-brand-muted hover:bg-gray-50"
          )}
        >
          Födelsedagsmail
        </button>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Editor */}
        <Card>
          <CardHeader
            title={`Redigera ${activeTemplate === 'welcome' ? 'Välkomstmail' : 'Födelsedagsmail'}`}
            icon={Zap}
            action={
              <button
                onClick={() => setShowPreview(!showPreview)}
                className={cn(
                  "px-3 py-1.5 text-xs font-medium rounded-lg transition-all",
                  showPreview ? "bg-brand-dark text-white" : "bg-gray-100 text-brand-muted hover:bg-gray-200"
                )}
              >
                <Eye className="w-3.5 h-3.5 inline mr-1" />
                {showPreview ? 'Dölj' : 'Visa'} 
              </button>
            }
          />
          <CardContent className="space-y-4">
            <div className="bg-blue-50/50 border border-blue-100 p-4 rounded-xl flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
              <div className="text-sm text-blue-800">
                <strong>{activeTemplate === 'welcome' ? 'Triggas automatiskt' : 'Triggas automatiskt'}</strong>
                <p className="mt-1 opacity-80">
                  {activeTemplate === 'welcome' 
                    ? 'Detta mail skickas automatiskt ut till nya kunder (som upptäcks i Timewave) nästkommande natt kl 03:00.'
                    : 'Detta mail skickas automatiskt ut kl 03:00 till de kunder vars födelsedag (enligt personnumret) inträffar exakt om 7 dagar.'}
                </p>
              </div>
            </div>

            <div className="space-y-1 mt-4">
              <label className="text-xs font-bold uppercase tracking-wider text-brand-muted ml-1">Ämnesrad för mailet</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex. Välkommen till Stodona!"
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent/20 focus:border-brand-accent transition-all font-medium"
              />
            </div>

            <div className="space-y-2 mt-6">
              <label className="text-xs font-bold uppercase tracking-wider text-brand-muted ml-1 mb-2 block">Dra och släpp block för att bygga mallen</label>
              {blocks.map((block, i) => renderBlockEditor(block, i))}
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-gray-100 mt-4">
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

        {/* Preview Container */}
        <div className="space-y-6">
          {showPreview ? (
            <Card>
              <CardHeader title="Förhandsgranskning" icon={Eye} />
              <CardContent className="p-0">
                <div className="bg-[#f5f3ef] p-6">
                  <div dangerouslySetInnerHTML={{ __html: previewHtml }} />
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="hidden xl:flex items-center justify-center h-full border-2 border-dashed border-gray-200 rounded-2xl bg-gray-50/50 text-gray-400 text-sm">
              <div className="text-center">
                <Eye className="w-8 h-8 mx-auto mb-2 opacity-20" />
                <p>Klicka på 'Visa förhandsgranskning' ovan <br/>för att se hur mailet kommer se ut.</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Save Strip */}
      <Card className="sticky bottom-8 shadow-xl mt-8 border-brand-accent/30 bg-white/90 backdrop-blur-lg z-20">
        <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4 py-4 px-6">
          <div className="flex items-center gap-4 text-sm text-brand-muted">
             <span className={cn("flex items-center gap-1.5", hasContent ? "text-emerald-600 font-medium" : "text-gray-400")}>
               {hasContent ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
               Mallen innehåller design
             </span>
             <span className={cn("flex items-center gap-1.5", subject.trim() ? "text-emerald-600 font-medium" : "text-gray-400")}>
               {subject.trim() ? <CheckCircle className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
               Ämnesrad är ifylld
             </span>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto">
            {saveResult && (
              <div className={cn("text-sm font-medium mr-2", saveResult.success ? "text-emerald-600" : "text-red-500")}>
                {saveResult.message}
              </div>
            )}
            <button
              onClick={handleSave}
              disabled={isSaving || !subject.trim()}
              className="w-full sm:w-auto px-8 py-3 bg-brand-dark text-white rounded-xl text-sm font-bold tracking-wider hover:bg-brand-accent transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
              {isSaving ? 'Sparar...' : 'Spara Automationsmall'}
            </button>
          </div>
        </CardContent>
      </Card>
      
    </div>
  );
}
