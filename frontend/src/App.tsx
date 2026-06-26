import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Trash2, User } from 'lucide-react';
import SearchBar, { AttachedDocument } from './components/SearchBar';
import ResponseDisplay from './components/ResponseDisplay';
import LoadingAnimation from './components/LoadingAnimation';
import AuthPage from './AuthPage';
import DocumentManager from './DocumentManager';
import ProfileModal from './ProfileModal';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

interface Message {
  query: string;
  response: string;
  attachment: AttachedDocument | null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isDocManagerOpen, setIsDocManagerOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Sirf SIGNED_OUT aur TOKEN_REFRESHED handle karo
      // SIGNED_IN intentionally ignore kiya — AuthPage OTP verify ke baad manually setSession karega
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setMessages([]);
      } else if (event === 'TOKEN_REFRESHED') {
        setSession(session);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const handleSearch = async (searchQuery: string, attachment: AttachedDocument | null) => {
    setLoading(true);
    setError('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;

      const res = await fetch(`${apiUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ query: searchQuery, top_k: 5 }),
      });

      if (!res.ok) throw new Error('API Error');

      const data = await res.json();

      setMessages(prev => [...prev, { query: searchQuery, response: data.summary, attachment }]);

    } catch (err) {
      setError('Backend not reachable. Make sure FastAPI is running on http://localhost:8000');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAttachment = async (documentId: string) => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) return;

      await fetch(`${apiUrl}/documents/${documentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
    } catch (err) {
      // Ignore network errors here — we still clear it from the UI below
    } finally {
      removeAttachmentFromMessages(documentId);
    }
  };

  const removeAttachmentFromMessages = (documentId: string) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.attachment?.document_id === documentId
          ? { ...msg, attachment: null }
          : msg
      )
    );
  };

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900">

      <nav className="bg-slate-900/50 backdrop-blur-md border-b border-purple-500/20 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-pink-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">RAG</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-purple-300 text-sm">AI-Powered Document Search</p>
            <button
              onClick={() => setIsDocManagerOpen(true)}
              className="text-sm text-purple-300 border border-purple-500/30 rounded-lg px-3 py-1.5 hover:bg-purple-500/10"
            >
              Your Docs
            </button>
            <button
              onClick={() => setIsProfileOpen(true)}
              aria-label="Open profile"
              title="Your Profile"
              className="w-9 h-9 flex items-center justify-center rounded-full bg-gradient-to-br from-purple-400 to-pink-600 hover:opacity-90 transition-opacity"
            >
              <User size={16} className="text-white" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-12 flex flex-col gap-8 justify-end min-h-[80vh]">

        <AnimatePresence>
          {messages.length === 0 && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="text-center pt-8"
            >
              <h2 className="text-4xl font-bold text-white mb-3">
                Ask Your Documents
              </h2>
              <p className="text-purple-300 max-w-xl mx-auto text-base">
                Search through PDFs and text files. Get AI-powered answers from your actual content.
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col gap-8">
          {messages.map((msg, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              <div className="border border-purple-500/40 rounded-xl px-4 py-3 mb-4 bg-purple-500/10">
                <p className="text-xs text-purple-300 font-mono mb-2">
                  You asked: <span className="text-white">"{msg.query}"</span>
                </p>

                {msg.attachment && (
                  <div className="inline-flex items-center gap-2 bg-slate-800/60 border border-purple-500/30 rounded-lg px-3 py-1.5 group relative">
                    <FileText size={14} className="text-purple-300" />
                    <span className="text-xs text-white max-w-[160px] truncate">
                      {msg.attachment.filename}
                    </span>
                    <button
                      onClick={() => handleDeleteAttachment(msg.attachment!.document_id)}
                      className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-400 transition-opacity ml-1"
                      aria-label="Delete document"
                      title="Delete document"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                )}
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

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <SearchBar onSearch={handleSearch} disabled={loading} />
        </motion.div>

      </main>

      <DocumentManager
        isOpen={isDocManagerOpen}
        onClose={() => setIsDocManagerOpen(false)}
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
