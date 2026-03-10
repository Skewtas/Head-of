import React, { useState, useEffect } from 'react';
import { Mail, Search, Inbox, Send, File, Archive, Reply, ReplyAll, Forward, Paperclip, MoreVertical, Check, Flag, Trash2, Edit3, XCircle } from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { OutlookGraphService } from './services/OutlookGraphService';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function MailView() {
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [emails, setEmails] = useState<any[]>([]);
  const [selectedEmail, setSelectedEmail] = useState<any>(null);
  const [currentFolder, setCurrentFolder] = useState('inbox');
  const [replyMode, setReplyMode] = useState<'reply' | 'replyAll' | 'forward' | 'new' | null>(null);
  const [replyText, setReplyText] = useState('');
  const [forwardTo, setForwardTo] = useState('');
  const [newMailTo, setNewMailTo] = useState('');
  const [newMailSubject, setNewMailSubject] = useState('');

  useEffect(() => {
    checkConnection();
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') checkConnection();
    };
    window.addEventListener('message', handleMessage);
    
    // Polling for 2-way sync
    const interval = setInterval(() => {
      if (isConnected) fetchEmails(currentFolder, false);
    }, 30000);
    
    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
    };
  }, [isConnected, currentFolder]);

  const checkConnection = async () => {
    try {
      const res = await fetch('/api/mail/status');
      const data = await res.json();
      setIsConnected(data.connected);
      if (data.connected) fetchEmails(currentFolder);
      else setIsLoading(false);
    } catch (err) {
      setIsLoading(false);
    }
  };

  const fetchEmails = async (folder: string, showLoading = true) => {
    if (showLoading) setIsLoading(true);
    try {
      const res = await fetch(`/api/mail/messages?folder=${folder}`);
      if (res.ok) {
        const data = await res.json();
        setEmails(data);
        if (data.length > 0 && !selectedEmail) setSelectedEmail(data[0]);
      } else if (res.status === 401) {
        setIsConnected(false);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleConnect = async () => {
    const res = await fetch('/api/auth/url');
    const data = await res.json();
    if (data.url) window.open(data.url, 'oauth_popup', 'width=600,height=700');
  };

  const handleFolderChange = (folder: string) => {
    setCurrentFolder(folder);
    setSelectedEmail(null);
    setReplyMode(null);
    fetchEmails(folder);
  };

  const handleSelectEmail = async (email: any) => {
    setSelectedEmail(email);
    setReplyMode(null);
    if (!email.isRead) {
      // Mark as read immediately in UI
      setEmails(prev => prev.map(e => e.id === email.id ? { ...e, isRead: true } : e));
      // Sync to Graph API
      try {
        await OutlookGraphService.markAsRead(email.id, true);
      } catch (err) {
        console.error("Failed to mark as read", err);
      }
    }
  };

  const handleSendReply = async () => {
    if (!replyText) return;
    
    try {
      if (replyMode === 'new') {
        await OutlookGraphService.sendMail(newMailSubject, replyText, [newMailTo]);
      } else if (replyMode === 'reply') {
        await OutlookGraphService.reply(selectedEmail.id, replyText);
      } else if (replyMode === 'replyAll') {
        await OutlookGraphService.replyAll(selectedEmail.id, replyText);
      } else if (replyMode === 'forward') {
        await OutlookGraphService.forward(selectedEmail.id, replyText, [forwardTo]);
      }
      
      setReplyMode(null);
      setReplyText('');
      setForwardTo('');
      setNewMailTo('');
      setNewMailSubject('');
      // Refresh to see sent item if in sent folder, or just to sync
      fetchEmails(currentFolder, false);
    } catch (err) {
      console.error("Failed to send", err);
    }
  };

  const handleAction = async (action: 'archive' | 'flag' | 'unread' | 'delete') => {
    if (!selectedEmail) return;
    
    try {
      if (action === 'archive') {
        setEmails(prev => prev.filter(e => e.id !== selectedEmail.id));
        const idToArchive = selectedEmail.id;
        setSelectedEmail(null);
        await OutlookGraphService.moveToArchive(idToArchive);
      } else if (action === 'delete') {
        setEmails(prev => prev.filter(e => e.id !== selectedEmail.id));
        const idToDelete = selectedEmail.id;
        setSelectedEmail(null);
        await OutlookGraphService.deleteMessage(idToDelete);
      } else if (action === 'flag') {
        const newFlag = selectedEmail.flag?.flagStatus === 'flagged' ? 'notFlagged' : 'flagged';
        setEmails(prev => prev.map(e => e.id === selectedEmail.id ? { ...e, flag: { flagStatus: newFlag } } : e));
        setSelectedEmail({ ...selectedEmail, flag: { flagStatus: newFlag } });
        await fetch(`/api/mail/message/${selectedEmail.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ flag: { flagStatus: newFlag } })
        });
      } else if (action === 'unread') {
        setEmails(prev => prev.map(e => e.id === selectedEmail.id ? { ...e, isRead: false } : e));
        setSelectedEmail({ ...selectedEmail, isRead: false });
        await OutlookGraphService.markAsRead(selectedEmail.id, false);
      }
    } catch (err) {
      console.error("Action failed", err);
    }
  };

  const formatDate = (dateString: string) => {
    return new Intl.DateTimeFormat('sv-SE', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(dateString));
  };

  return (
    <div className="h-[calc(100vh-12rem)] min-h-[600px] flex flex-col space-y-4">
      <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <Mail className="w-5 h-5 text-gray-400" />
          <span className="text-sm font-semibold text-gray-800 tracking-tight">Outlook Integration</span>
        </div>
        {!isConnected ? (
          <button onClick={handleConnect} className="px-4 py-2 bg-[#faf8f5] border border-[#eae4d9] rounded-xl text-xs font-bold text-[#5c5750] tracking-widest uppercase shadow-sm hover:bg-white hover:-translate-y-0.5 transition-all duration-300">
            CONNECT OUTLOOK
          </button>
        ) : (
          <div className="flex items-center gap-4">
            <button onClick={() => setReplyMode('new')} className="px-4 py-2 bg-gray-900 text-white rounded-xl text-xs font-bold uppercase tracking-wider hover:bg-gray-800 transition-colors flex items-center gap-2">
              <Edit3 className="w-4 h-4" /> Nytt mail
            </button>
            <span className="px-3 py-1 bg-[#A8E6CF]/20 text-emerald-700 rounded-lg text-xs font-bold uppercase tracking-wider">Connected</span>
          </div>
        )}
      </div>

      <div className="flex-1 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex">
        {/* Folders */}
        <div className="w-48 border-r border-gray-100 bg-gray-50/30 p-4 hidden md:block">
          <nav className="space-y-1">
            {[
              { id: 'inbox', icon: Inbox, label: 'Inbox' },
              { id: 'sent', icon: Send, label: 'Sent' },
              { id: 'drafts', icon: File, label: 'Drafts' },
              { id: 'archive', icon: Archive, label: 'Archive' }
            ].map(f => (
              <button 
                key={f.id}
                onClick={() => handleFolderChange(f.id)}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
                  currentFolder === f.id ? "bg-white text-rose-600 shadow-sm border border-gray-100" : "text-gray-600 hover:bg-gray-50"
                )}
              >
                <f.icon className="w-4 h-4" /> {f.label}
              </button>
            ))}
          </nav>
        </div>

        {/* List */}
        <div className="w-full md:w-80 border-r border-gray-100 flex flex-col">
          <div className="p-3 border-b border-gray-100">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input type="text" placeholder="Sök mail..." className="w-full pl-9 pr-3 py-1.5 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500" />
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-4 text-center text-sm text-gray-500">Laddar...</div>
            ) : !isConnected ? (
              <div className="p-4 text-center text-sm text-gray-500">Koppla ditt Outlook-konto för att se dina mail här.</div>
            ) : emails.length === 0 ? (
              <div className="p-4 text-center text-sm text-gray-500">Inga mail hittades.</div>
            ) : (
              emails.map((email) => (
                <div 
                  key={email.id}
                  onClick={() => handleSelectEmail(email)}
                  className={cn(
                    "p-3 border-b border-gray-50 cursor-pointer transition-colors relative",
                    selectedEmail?.id === email.id ? "bg-rose-50/50" : "hover:bg-gray-50/50",
                    !email.isRead && "bg-gray-50/30"
                  )}
                >
                  {email.flag?.flagStatus === 'flagged' && <Flag className="w-3 h-3 text-rose-500 absolute top-3 right-3 fill-rose-500" />}
                  <div className="flex justify-between items-baseline mb-1">
                    <span className={cn("text-sm truncate pr-6", !email.isRead ? "font-bold text-gray-900" : "font-medium text-gray-700")}>
                      {email.sender?.emailAddress?.name || email.sender?.emailAddress?.address || 'Okänd'}
                    </span>
                    <span className={cn("text-xs shrink-0", !email.isRead ? "text-rose-600 font-medium" : "text-gray-400")}>
                      {formatDate(email.receivedDateTime)}
                    </span>
                  </div>
                  <p className={cn("text-xs mb-1 truncate", !email.isRead ? "font-bold text-gray-800" : "text-gray-700")}>
                    {email.subject || '(Inget ämne)'}
                  </p>
                  <p className="text-xs text-gray-500 truncate">{email.bodyPreview}</p>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Preview & Editor */}
        <div className="flex-1 hidden lg:flex flex-col bg-[#faf9f9] relative">
          {replyMode === 'new' ? (
            <div className="flex-1 flex flex-col bg-white">
              <div className="p-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="text-lg font-bold text-gray-900">Nytt mail</h2>
                <button onClick={() => setReplyMode(null)} className="text-gray-400 hover:text-gray-600"><XCircle className="w-5 h-5" /></button>
              </div>
              <div className="p-4 border-b border-gray-100 space-y-3">
                <input type="text" placeholder="Till" value={newMailTo} onChange={e => setNewMailTo(e.target.value)} className="w-full text-sm border-none focus:ring-0 p-0 text-gray-900 placeholder-gray-400" />
                <div className="h-px bg-gray-100" />
                <input type="text" placeholder="Ämne" value={newMailSubject} onChange={e => setNewMailSubject(e.target.value)} className="w-full text-sm font-medium border-none focus:ring-0 p-0 text-gray-900 placeholder-gray-400" />
              </div>
              <textarea 
                className="flex-1 w-full p-4 text-sm text-gray-700 resize-none border-none focus:ring-0" 
                placeholder="Skriv ditt meddelande..."
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
              />
              <div className="p-4 border-t border-gray-100 flex justify-between items-center bg-gray-50/50">
                <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><Paperclip className="w-5 h-5" /></button>
                <button onClick={handleSendReply} className="px-6 py-2 bg-gray-900 text-white rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-gray-800">Skicka</button>
              </div>
            </div>
          ) : selectedEmail ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* Header Actions */}
              <div className="p-3 border-b border-gray-100 bg-white flex justify-between items-center shrink-0">
                <div className="flex gap-2">
                  <button onClick={() => setReplyMode('reply')} className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg flex items-center gap-2"><Reply className="w-4 h-4" /> Svara</button>
                  <button onClick={() => setReplyMode('replyAll')} className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg flex items-center gap-2"><ReplyAll className="w-4 h-4" /> Svara alla</button>
                  <button onClick={() => setReplyMode('forward')} className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg flex items-center gap-2"><Forward className="w-4 h-4" /> Vidarebefordra</button>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => handleAction('unread')} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" title="Markera som oläst"><Mail className="w-4 h-4" /></button>
                  <button onClick={() => handleAction('flag')} className="p-2 text-gray-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg" title="Flagga"><Flag className={cn("w-4 h-4", selectedEmail.flag?.flagStatus === 'flagged' && "fill-rose-500 text-rose-500")} /></button>
                  <button onClick={() => handleAction('archive')} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg" title="Arkivera"><Archive className="w-4 h-4" /></button>
                </div>
              </div>

              {/* Mail Content */}
              <div className="flex-1 overflow-y-auto p-6 bg-white">
                <h2 className="text-2xl font-bold text-gray-900 mb-6">{selectedEmail.subject || '(Inget ämne)'}</h2>
                <div className="flex items-center justify-between mb-8">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-rose-100 flex items-center justify-center text-rose-600 font-bold uppercase">
                      {(selectedEmail.sender?.emailAddress?.name || selectedEmail.sender?.emailAddress?.address || '?').charAt(0)}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">
                        {selectedEmail.sender?.emailAddress?.name || 'Okänd'}
                      </p>
                      <p className="text-xs text-gray-500">&lt;{selectedEmail.sender?.emailAddress?.address}&gt;</p>
                    </div>
                  </div>
                  <span className="text-sm text-gray-500 font-medium">{formatDate(selectedEmail.receivedDateTime)}</span>
                </div>
                <div 
                  className="text-sm text-gray-800 leading-relaxed prose prose-sm max-w-none"
                  dangerouslySetInnerHTML={{ __html: selectedEmail.body?.content || selectedEmail.bodyPreview }}
                />
              </div>

              {/* Reply Editor */}
              {replyMode && (
                <div className="border-t border-gray-200 bg-white shrink-0 flex flex-col shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.1)] z-10">
                  <div className="p-3 border-b border-gray-100 bg-gray-50 flex items-center gap-2 text-sm font-medium text-gray-700">
                    {replyMode === 'reply' && <><Reply className="w-4 h-4" /> Svarar till {selectedEmail.sender?.emailAddress?.name}</>}
                    {replyMode === 'replyAll' && <><ReplyAll className="w-4 h-4" /> Svarar alla</>}
                    {replyMode === 'forward' && <><Forward className="w-4 h-4" /> Vidarebefordrar</>}
                    <button onClick={() => setReplyMode(null)} className="ml-auto text-gray-400 hover:text-gray-600"><XCircle className="w-4 h-4" /></button>
                  </div>
                  {replyMode === 'forward' && (
                    <div className="px-4 py-2 border-b border-gray-100">
                      <input type="text" placeholder="Till..." value={forwardTo} onChange={e => setForwardTo(e.target.value)} className="w-full text-sm border-none focus:ring-0 p-0" />
                    </div>
                  )}
                  <textarea 
                    className="w-full p-4 text-sm text-gray-700 resize-none border-none focus:ring-0 min-h-[120px]" 
                    placeholder="Skriv ditt meddelande..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    autoFocus
                  />
                  <div className="p-3 border-t border-gray-100 flex justify-between items-center">
                    <button className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"><Paperclip className="w-5 h-5" /></button>
                    <button onClick={handleSendReply} className="px-6 py-2 bg-gray-900 text-white rounded-xl text-sm font-bold uppercase tracking-wider hover:bg-gray-800">Skicka</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Välj ett mail för att läsa
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Need to add XCircle to lucide-react imports in the file where this is used, but we'll just define a simple SVG if needed, or import it.
import { XCircle } from 'lucide-react';
