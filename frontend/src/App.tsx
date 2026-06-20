import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import SearchBar from './components/SearchBar';
import ResponseDisplay from './components/ResponseDisplay';
import LoadingAnimation from './components/LoadingAnimation';

interface Message {
  query: string;
  response: string;
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  // Har nayi message ke baad neeche scroll karo
  useEffect(() => {
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loading]);

  const handleSearch = async (searchQuery: string) => {
    setLoading(true);
    setError('');

    try {
      const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';
      const res = await fetch(`${apiUrl}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: searchQuery, top_k: 5 }),
      });

      if (!res.ok) throw new Error('API Error');

      const data = await res.json();

      // Purana answer rehta hai — naya add hota hai
      setMessages(prev => [...prev, { query: searchQuery, response: data.summary }]);

    } catch (err) {
      setError('Backend not reachable. Make sure FastAPI is running on http://localhost:8000');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900">

      {/* Nav */}
      <nav className="bg-slate-900/50 backdrop-blur-md border-b border-purple-500/20 sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-gradient-to-br from-purple-400 to-pink-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold">RAG</span>
            </div>
          </div>
          <p className="text-purple-300 text-sm">AI-Powered Document Search</p>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-4 py-12 flex flex-col gap-8 justify-end min-h-[80vh]">

        {/* Hero — sirf tab jab koi message nahi */}
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

        {/* Saari messages — purani bhi, nayi bhi */}
        <div className="flex flex-col gap-8">
          {messages.map((msg, index) => (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
            >
              {/* Question border mein */}
              <div className="border border-purple-500/40 rounded-xl px-4 py-3 mb-4 bg-purple-500/10">
                <p className="text-xs text-purple-300 font-mono">
                  You asked: <span className="text-white">"{msg.query}"</span>
                </p>
              </div>

              {/* Answer */}
              <ResponseDisplay markdown={msg.response} />
            </motion.div>
          ))}
        </div>

        {/* Error */}
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

        {/* Loading */}
        <AnimatePresence>
          {loading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <LoadingAnimation />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auto scroll yahan tak */}
        <div ref={bottomRef} />

        {/* Search bar — hamesha neeche */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <SearchBar onSearch={handleSearch} disabled={loading} />
        </motion.div>

      </main>
    </div>
  );
}
