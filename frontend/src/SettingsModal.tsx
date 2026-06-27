// SettingsModal.tsx
// NEW: Central Settings panel — controls which uploaded documents are
// GLOBALLY enabled/disabled. This setting applies to every chat
// automatically, replacing the old per-chat "Toggle Documents" panel
// that used to live inside SearchBar.
//
// Toggling a document here calls PATCH /documents/{id}, which persists
// the enabled flag in Supabase, so the setting survives refreshes and
// applies the same way across all chats.

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, ToggleLeft, ToggleRight, Settings as SettingsIcon } from 'lucide-react';
import { supabase } from './supabaseClient';

interface DocumentRecord {
  id: string;
  filename: string;
  enabled: boolean; // NEW: global enabled flag, persisted in Supabase
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  // Tells the parent (App.tsx) that document state changed, so any open
  // chat's SearchBar can refresh its "X/Y docs active" summary.
  onDocumentsChanged?: () => void;
}

export default function SettingsModal({ isOpen, onClose, onDocumentsChanged }: SettingsModalProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  const getAuthHeader = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('No active session. Please log in again.');
    return { Authorization: `Bearer ${token}` };
  };

  const fetchDocuments = async () => {
    setLoading(true);
    setError('');
    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/documents`, { headers });
      if (!res.ok) throw new Error('Failed to load documents.');
      const data = await res.json();
      // Backend rows already include `enabled` (defaults to true for older rows
      // once the DB column default is set) — fall back to true just in case.
      setDocuments(
        (data.documents ?? []).map((d: any) => ({
          id: d.id,
          filename: d.filename,
          enabled: d.enabled ?? true,
        }))
      );
    } catch (err: any) {
      setError(err.message || 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  };

  // Reload the list every time the panel is opened
  useEffect(() => {
    if (isOpen) {
      fetchDocuments();
    }
  }, [isOpen]);

  // Flip a document's global enabled state via PATCH /documents/{id}
  const handleToggle = async (doc: DocumentRecord) => {
    const newEnabled = !doc.enabled;
    setTogglingId(doc.id);
    setError('');

    // Optimistic UI update — flip immediately, revert on failure
    setDocuments(prev =>
      prev.map(d => (d.id === doc.id ? { ...d, enabled: newEnabled } : d))
    );

    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/documents/${doc.id}`, {
        method: 'PATCH',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newEnabled }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to update document.');
      }

      onDocumentsChanged?.(); // Let App.tsx know — open chats refresh their summary
    } catch (err: any) {
      // Revert the optimistic change on failure
      setDocuments(prev =>
        prev.map(d => (d.id === doc.id ? { ...d, enabled: doc.enabled } : d))
      );
      setError(err.message || 'Failed to update document.');
    } finally {
      setTogglingId(null);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg bg-slate-900 border border-purple-500/20 rounded-2xl p-6 max-h-[80vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <SettingsIcon size={18} className="text-purple-300" />
                <h2 className="text-xl font-bold text-white">Settings</h2>
              </div>
              <button
                onClick={onClose}
                className="text-purple-300 hover:text-white text-xl leading-none px-2"
              >
                ×
              </button>
            </div>

            <p className="text-purple-300/70 text-xs mb-1 font-semibold uppercase tracking-wide">
              Document Access
            </p>
            <p className="text-purple-300/70 text-xs mb-4">
              Turning a document off here removes it from every chat — not just the one you're in.
            </p>

            {/* Error message */}
            {error && (
              <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
                ⚠️ {error}
              </p>
            )}

            {/* Document toggle list */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2">
              {loading ? (
                <p className="text-purple-300 text-sm text-center py-6">Loading documents...</p>
              ) : documents.length === 0 ? (
                <p className="text-purple-300 text-sm text-center py-6">
                  No documents uploaded yet. Upload some from "Your Docs" first.
                </p>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between bg-slate-800/60 border border-purple-500/20 rounded-lg px-4 py-2.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={16} className="text-purple-300 shrink-0" />
                      <span className={`text-sm truncate ${doc.enabled ? 'text-white' : 'text-slate-500 line-through'}`}>
                        {doc.filename}
                      </span>
                    </div>
                    <button
                      onClick={() => handleToggle(doc)}
                      disabled={togglingId === doc.id}
                      title={doc.enabled ? 'Disable in all chats' : 'Enable in all chats'}
                      className={`shrink-0 ml-3 transition-colors disabled:opacity-50 ${doc.enabled ? 'text-purple-400' : 'text-slate-600'}`}
                    >
                      {doc.enabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                    </button>
                  </div>
                ))
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
