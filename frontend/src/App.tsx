// App.tsx
// NEW: Chats ab Supabase database mein save hote hain — bilkul documents ki tarah.
// Login ke baad purane chats wapas aa jaate hain, logout pe clear hote hain.

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trash2, Plus, MessageSquare, ChevronLeft, ChevronRight, FileText, Settings } from 'lucide-react';
import SearchBar, { AttachedDocument } from './components/SearchBar';
import ResponseDisplay from './components/ResponseDisplay';
import LoadingAnimation from './components/LoadingAnimation';
import AuthPage from './AuthPage';
import DocumentManager from './DocumentManager';
import SettingsModal from './SettingsModal';
import ProfileModal, { getDisplayName } from './ProfileModal';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

// --- Type Definitions ---

interface Message {
  role: 'user' | 'assistant'; // "user" = insaan, "assistant" = AI
  query: string;               // User ka sawal
  response: string;            // AI ka jawab
  attachments: AttachedDocument[]; // CHANGED: ab ek se zyada attached documents ho sakte hain
}

interface Chat {
  id: string;           // UUID — Supabase mein primary key
  title: string;        // Pehle message se auto-generate hota hai
  messages: Message[];  // Is chat ke saare messages
  createdAt: number;    // Sorting ke liye timestamp
}

// --- Supabase Chat Helpers ---

/**
 * NEW: Purane format ke messages ko naye format mein convert karo.
 * Pehle har message mein `attachment` (single, ya null) hota tha.
 * Ab `attachments` (array) hota hai. Purane saved chats abhi bhi
 * Supabase mein purane format mein pade hain — yeh function unhe
 * safely naye format mein normalize karta hai taake .map()/.length
 * crash na karein.
 */
function normalizeMessage(raw: any): Message {
  let attachments: AttachedDocument[] = [];

  if (Array.isArray(raw?.attachments)) {
    // Already naya format hai
    attachments = raw.attachments;
  } else if (raw?.attachment) {
    // Purana format: single object — array mein wrap karo
    attachments = [raw.attachment];
  }
  // Agar koi bhi field nahi hai (na attachments na attachment), attachments = []

  return {
    role: raw?.role === 'assistant' ? 'assistant' : 'user',
    query: raw?.query ?? '',
    response: raw?.response ?? '',
    attachments,
  };
}

/** Login ke baad is user ke saare chats fetch karo Supabase se */
async function fetchChatsFromSupabase(): Promise<Chat[]> {
  const { data, error } = await supabase
    .from('chats')                          // "chats" table
    .select('*')                            // Saare columns
    .order('created_at', { ascending: false }); // Nayi chats upar

  if (error || !data) return []; // Error pe empty array return karo

  // Supabase row ko apne Chat type mein convert karo
  return data.map((row: any) => ({
    id: row.id,
    title: row.title,
    // CHANGED: har message ko normalize karo — purane "attachment" format
    // wale chats bhi bina crash hue load ho jayenge
    messages: (row.messages ?? []).map(normalizeMessage),
    createdAt: new Date(row.created_at).getTime(), // string ko number mein badlo
  }));
}

/** Naya chat Supabase mein insert karo */
async function insertChatToSupabase(chat: Chat, userId: string) {
  await supabase.from('chats').insert({
    id: chat.id,             // UUID
    user_id: userId,         // Kis user ka chat hai
    title: chat.title,       // Chat ka naam
    messages: chat.messages, // Messages array (jsonb)
  });
}

/** Existing chat ke messages aur title update karo Supabase mein */
async function updateChatInSupabase(chat: Chat) {
  await supabase
    .from('chats')
    .update({
      title: chat.title,       // Title update (pehle message ke baad)
      messages: chat.messages, // Naye messages save karo
    })
    .eq('id', chat.id);        // Sirf is specific chat ko update karo
}

/** Chat delete karo Supabase se */
async function deleteChatFromSupabase(chatId: string) {
  await supabase
    .from('chats')
    .delete()
    .eq('id', chatId); // Sirf is ID wali chat delete karo
}

/** Pehle message se short title banao (max 40 chars) */
function generateChatTitle(firstMessage: string): string {
  return firstMessage.length > 40
    ? firstMessage.slice(0, 40) + '...'
    : firstMessage;
}

/** Bilkul naya khali chat object banao */
function createNewChat(): Chat {
  return {
    id: crypto.randomUUID(), // Browser mein UUID generate karo
    title: 'New Chat',       // Default title
    messages: [],            // Koi message nahi abhi
    createdAt: Date.now(),   // Abhi ka time
  };
}

// --- Main App Component ---

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [chats, setChats] = useState<Chat[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  // CHANGED: Sidebar ab default band rehti hai — user khud kholega toggle button se.
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const [isDocManagerOpen, setIsDocManagerOpen] = useState(false);
  // NEW: Settings panel — global document enable/disable lives here now
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // NEW: jab bhi hub (DocumentManager) se upload/delete ho, yeh number badhta hai —
  // SearchBar isko dependency ke taur pe use karke apni docs list refresh karta hai
  const [docsRefreshKey, setDocsRefreshKey] = useState(0);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  // --- Auth check on mount ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setChats([]);
        setActiveChatId(null);
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  // --- Login hone ke baad Supabase se chats load karo ---
  // CHANGED: Login pe ab koi chat automatically open nahi hoti — sidebar mein
  // purani chats list dikhti hain, lekin user khud koi chat select kare,
  // tab tak "Ask Your Documents" wala fresh/blank screen hi dikhega.
  useEffect(() => {
    if (!session) return; // Login nahi hai toh kuch mat karo

    fetchChatsFromSupabase().then(loadedChats => {
      setChats(loadedChats); // Supabase se aaye chats state mein set karo — activeChatId ko yahan touch nahi karte
    });
  }, [session]); // session change hone pe chalega (login ke waqt)

  // --- Auto-scroll ---
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chats, loading]);

  const activeChat = chats.find(c => c.id === activeChatId) ?? null;

  // --- Naya chat banao ---
  const handleNewChat = async () => {
    if (!session) return;
    const newChat = createNewChat();
    setChats(prev => [newChat, ...prev]);  // List mein sabse upar add karo
    setActiveChatId(newChat.id);
    setError('');
    await insertChatToSupabase(newChat, session.user.id); // Supabase mein save karo
  };

  // --- Chat delete karo ---
  const handleDeleteChat = async (chatId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const remaining = chats.filter(c => c.id !== chatId);
    setChats(remaining); // UI se hataao
    if (activeChatId === chatId) {
      setActiveChatId(remaining[0]?.id ?? null); // Doosri chat pe jaao
    }
    await deleteChatFromSupabase(chatId); // Supabase se bhi delete karo
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // --- Search handler ---
  // CHANGED: enabledDocIds parameter removed — backend now determines which
  // documents to search based on the global Settings (enabled flag in Supabase),
  // not a per-chat list passed from the frontend.
  const handleSearch = async (
    searchQuery: string,
    attachments: AttachedDocument[]
  ) => {
    if (!session) return;

    let currentChatId = activeChatId;

    // Agar koi chat active nahi hai toh pehle naya banao
    if (!currentChatId) {
      const newChat = createNewChat();
      setChats(prev => [newChat, ...prev]);
      setActiveChatId(newChat.id);
      currentChatId = newChat.id;
      await insertChatToSupabase(newChat, session.user.id);
    }

    setLoading(true);
    setError('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      // Is chat ki purani messages se history banao
      const currentChat = chats.find(c => c.id === currentChatId);
      const chatHistory = (currentChat?.messages ?? []).map(m => ({
        role: m.role,
        content: m.role === 'user' ? m.query : m.response,
      }));

      const res = await fetch(`${apiUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: searchQuery,
          top_k: 5,
          chat_history: chatHistory, // Purani baatein AI ko do
          // CHANGED: enabled_document_ids ab nahi bhejte — backend Settings se khud check karega
        }),
      });

      if (!res.ok) throw new Error('API Error');
      const data = await res.json();

      const newMessage: Message = {
        role: 'user',
        query: searchQuery,
        response: data.summary,
        attachments, // CHANGED: ab array store hota hai
      };

      setChats(prev => prev.map(chat => {
        if (chat.id !== currentChatId) return chat;

        const updatedChat = {
          ...chat,
          title: chat.messages.length === 0
            ? generateChatTitle(searchQuery) // Pehla message = title
            : chat.title,
          messages: [...chat.messages, newMessage],
        };

        updateChatInSupabase(updatedChat); // Supabase mein save karo (async)
        return updatedChat;
      }));

    } catch {
      setError('Backend not reachable. Make sure FastAPI is running on http://localhost:8000');
    } finally {
      setLoading(false);
    }
  };

  // --- Document attachment delete ---
  const handleDeleteAttachment = async (documentId: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;
      await fetch(`${apiUrl}/documents/${documentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch {}
    finally {
      setChats(prev => prev.map(chat => {
        const updatedChat = {
          ...chat,
          // CHANGED: ab specific attachment ko array se filter karke nikalte hain
          messages: chat.messages.map(msg => ({
            ...msg,
            attachments: (msg.attachments ?? []).filter(a => a.document_id !== documentId),
          })),
        };
        updateChatInSupabase(updatedChat);
        return updatedChat;
      }));
    }
  };

  // --- Loading / Auth screens ---
  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900 flex items-center justify-center">
        <p className="text-purple-300">Loading...</p>
      </div>
    );
  }

  if (!session) {
    return <AuthPage setSession={setSession} />;
  }

  // CHANGED: Profile footer ke liye naam aur avatar letter nikal liye.
  const displayName = getDisplayName(session);
  const avatarLetter = displayName.charAt(0).toUpperCase();

  return (
    // CHANGED: h-screen + overflow-hidden (instead of min-h-screen) locks the
    // whole layout to the viewport height. Without this, long chats grew the
    // page taller than the screen, creating a page-level scroll that dragged
    // the sidebar along with it. Now only <main> below scrolls internally —
    // the sidebar stays fixed, like Claude's own layout.
    <div className="h-screen overflow-hidden bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900 flex">

      {/* ====== SIDEBAR ====== */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 260, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col bg-slate-900/80 border-r border-purple-500/20 overflow-hidden shrink-0"
          >
            <div className="p-4 border-b border-purple-500/20 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-xs">RAG</span>
                </div>
                <span className="text-white font-semibold text-sm">YTRAG</span>
              </div>
              <button
                onClick={handleNewChat}
                title="New Chat"
                className="w-8 h-8 flex items-center justify-center rounded-lg bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 transition-colors"
              >
                <Plus size={16} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2">
              {chats.length === 0 ? (
                <p className="text-purple-400/50 text-xs text-center mt-8 px-4">
                  No chats yet. Start a new conversation!
                </p>
              ) : (
                <>
                  {/* CHANGED: "Recents" heading chats list ke upar */}
                  <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-purple-400/60">
                    Recents
                  </p>
                  {chats.map(chat => (
                    <button
                      key={chat.id}
                      onClick={() => setActiveChatId(chat.id)}
                      className={`w-full text-left px-4 py-3 flex items-center gap-2 group transition-colors hover:bg-purple-500/10
                        ${activeChatId === chat.id ? 'bg-purple-500/20 border-r-2 border-purple-400' : ''}`}
                    >
                      <MessageSquare size={14} className="text-purple-400 shrink-0" />
                      <span className="text-sm text-white/80 truncate flex-1">{chat.title}</span>
                      <span
                        role="button"
                        onClick={(e) => handleDeleteChat(chat.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-300 transition-opacity p-1"
                        title="Delete chat"
                      >
                        <Trash2 size={12} />
                      </span>
                    </button>
                  ))}
                </>
              )}
            </div>

            {/* NEW: Your Docs + Settings — moved here from navbar, sit above the profile footer */}
            <div className="border-t border-purple-500/20 px-2 py-2 flex flex-col gap-1 shrink-0">
              <button
                onClick={() => setIsDocManagerOpen(true)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-white/80 hover:bg-purple-500/10 transition-colors"
              >
                <FileText size={16} className="text-purple-400" />
                Your Docs
              </button>
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-sm text-white/80 hover:bg-purple-500/10 transition-colors"
              >
                <Settings size={16} className="text-purple-400" />
                Settings
              </button>
            </div>

            {/* Sidebar footer — ChatGPT jaisa profile section (avatar + naam) */}
            <button
              onClick={() => setIsProfileOpen(true)}
              className="border-t border-purple-500/20 px-4 py-3 flex items-center gap-3 hover:bg-purple-500/10 transition-colors shrink-0"
            >
              <div className="w-8 h-8 bg-gradient-to-br from-purple-400 to-pink-600 rounded-full flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-xs">{avatarLetter}</span>
              </div>
              <span className="text-sm text-white/80 truncate">{displayName}</span>
            </button>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ====== MAIN CONTENT ====== */}
      <div className="flex-1 flex flex-col min-w-0">

        <nav className="bg-slate-900/50 backdrop-blur-md border-b border-purple-500/20 sticky top-0 z-50">
          <div className="px-4 py-4 flex items-center justify-between">
            <button
              onClick={() => setSidebarOpen(prev => !prev)}
              className="w-9 h-9 flex items-center justify-center rounded-lg text-purple-300 hover:bg-purple-500/10 transition-colors"
            >
              {sidebarOpen ? <ChevronLeft size={18} /> : <ChevronRight size={18} />}
            </button>

            <p className="text-purple-300 text-sm">AI-Powered Document Search</p>

            <div className="w-9" /> {/* spacer to keep title centered, matches toggle button width */}
          </div>
        </nav>

        <main className="flex-1 overflow-y-auto px-4 py-8">
          <div className="max-w-3xl mx-auto flex flex-col gap-8 min-h-full justify-end">

            <AnimatePresence>
              {(!activeChat || activeChat.messages.length === 0) && !loading && (
                <motion.div
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className="text-center pt-16"
                >
                  <h2 className="text-4xl font-bold text-white mb-3">Ask Your Documents</h2>
                  <p className="text-purple-300 max-w-xl mx-auto text-base">
                    Search through PDFs and text files. Get AI-powered answers with full conversation context.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex flex-col gap-8">
              {(activeChat?.messages ?? []).map((msg, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  {/* CHANGED: User ka sawal ab right side pe — chat bubble jaisa */}
                  <div className="flex justify-end mb-4">
                    <div className="border border-purple-500/40 rounded-xl px-4 py-3 bg-purple-500/10 max-w-[80%]">
                      {/* CHANGED: Saare attached documents grid cards mein dikhte hain */}
                      {(msg.attachments ?? []).length > 0 && (
                        <div className="flex flex-wrap gap-2 justify-end mb-2">
                          {(msg.attachments ?? []).map(att => {
                            const ext = att.filename.split('.').pop()?.toUpperCase() || 'FILE';
                            return (
                              <div
                                key={att.document_id}
                                className="relative group w-32 bg-slate-800/60 border border-purple-500/30 rounded-lg p-2.5 flex flex-col justify-between text-left"
                              >
                                <span className="text-xs text-white leading-snug line-clamp-3 break-words mb-1.5">
                                  {att.filename}
                                </span>
                                <span className="text-[10px] font-semibold text-purple-300 bg-purple-500/15 border border-purple-500/30 rounded px-1.5 py-0.5 w-fit">
                                  {ext}
                                </span>
                                <button
                                  onClick={() => handleDeleteAttachment(att.document_id)}
                                  className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 border border-purple-500/40 rounded-full flex items-center justify-center text-red-300 opacity-0 group-hover:opacity-100 hover:bg-red-500/80 hover:text-white transition-all"
                                >
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <p className="text-sm text-white text-right">{msg.query}</p>
                    </div>
                  </div>
                  <ResponseDisplay markdown={msg.response} />
                </motion.div>
              ))}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="p-4 bg-red-500/10 border border-red-500/30 rounded-xl text-red-300 text-sm"
                >
                  ⚠️ {error}
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {loading && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <LoadingAnimation />
                </motion.div>
              )}
            </AnimatePresence>

            <div ref={bottomRef} />
          </div>
        </main>

        <div className="border-t border-purple-500/20 bg-slate-900/30 backdrop-blur-sm px-4 py-4">
          <div className="max-w-3xl mx-auto">
            <SearchBar onSearch={handleSearch} disabled={loading} docsRefreshKey={docsRefreshKey} />
          </div>
        </div>
      </div>

      <DocumentManager
        isOpen={isDocManagerOpen}
        onClose={() => setIsDocManagerOpen(false)}
        onDocumentsChanged={() => setDocsRefreshKey(prev => prev + 1)}
      />
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onDocumentsChanged={() => setDocsRefreshKey(prev => prev + 1)}
      />
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        session={session}
        onLogout={handleLogout}
      />
    </div>
  );
}
