// DocumentManager.tsx
// Purpose: Modal component that shows the logged-in user's uploaded
// documents and lets them permanently delete any of them. Deleting a
// document removes its chunks from the FAISS vector store, removes its
// record from Supabase, and deletes the file from disk — once deleted,
// the user will no longer be able to search within that document.
// (Uploading happens separately via the "+" button in SearchBar.)

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Trash2 } from 'lucide-react';
import { supabase } from './supabaseClient';

interface DocumentRecord {
  id: string;
  filename: string;
  created_at: string;
}

interface DocumentManagerProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DocumentManager({ isOpen, onClose }: DocumentManagerProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  // Helper: get the current session's access token to attach to API calls
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
      setDocuments(data.documents || []);
    } catch (err: any) {
      setError(err.message || 'Failed to load documents.');
    } finally {
      setLoading(false);
    }
  };

  // Load the document list every time the panel is opened
  useEffect(() => {
    if (isOpen) {
      fetchDocuments();
    }
  }, [isOpen]);

  // Permanently deletes a document: removes it from the FAISS vector
  // store, the Supabase 'documents' table, and disk. After this, the
  // document's content can no longer be searched.
  const handleDelete = async (documentId: string) => {
    setDeletingId(documentId);
    setError('');

    try {
      const headers = await getAuthHeader();
      const res = await fetch(`${apiUrl}/documents/${documentId}`, {
        method: 'DELETE',
        headers,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Delete failed.');
      }

      // Remove it from the local list immediately
      setDocuments(prev => prev.filter(doc => doc.id !== documentId));
    } catch (err: any) {
      setError(err.message || 'Delete failed.');
    } finally {
      setDeletingId(null);
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
              <h2 className="text-xl font-bold text-white">Your Documents</h2>
              <button
                onClick={onClose}
                className="text-purple-300 hover:text-white text-xl leading-none px-2"
              >
                ×
              </button>
            </div>

            <p className="text-purple-300/70 text-xs mb-4">
              You can delete a document at any time.
            </p>

            {/* Error message */}
            {error && (
              <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 mb-4">
                ⚠️ {error}
              </p>
            )}

            {/* Document list */}
            <div className="flex-1 overflow-y-auto flex flex-col gap-2">
              {loading ? (
                <p className="text-purple-300 text-sm text-center py-6">Loading documents...</p>
              ) : documents.length === 0 ? (
                <p className="text-purple-300 text-sm text-center py-6">
                  No documents uploaded yet.
                </p>
              ) : (
                documents.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center justify-between bg-slate-800/60 border border-purple-500/20 rounded-lg px-4 py-2.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText size={16} className="text-purple-300 shrink-0" />
                      <span className="text-white text-sm truncate">{doc.filename}</span>
                    </div>
                    <button
                      onClick={() => handleDelete(doc.id)}
                      disabled={deletingId === doc.id}
                      className="flex items-center gap-1 text-red-300 text-sm hover:text-red-400 disabled:opacity-50 shrink-0 ml-3"
                    >
                      <Trash2 size={14} />
                      {deletingId === doc.id ? 'Deleting...' : 'Delete'}
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