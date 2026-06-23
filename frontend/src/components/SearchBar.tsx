// SearchBar.tsx
// Purpose: The main input bar for asking questions, now extended with
// an inline document attachment feature. Clicking the "+" button lets
// the user pick a file, which is immediately uploaded to the backend.
// Once uploaded, a preview card appears above the input showing the
// file, with a way to remove (delete) it before or after sending.

import { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Send, Plus, FileText, X } from 'lucide-react';
import { supabase } from '../supabaseClient';

export interface AttachedDocument {
  document_id: string;
  filename: string;
}

interface SearchBarProps {
  onSearch: (query: string, attachment: AttachedDocument | null) => void;
  disabled: boolean;
  onDocumentDeleted?: (documentId: string) => void;
}

export default function SearchBar({ onSearch, disabled, onDocumentDeleted }: SearchBarProps) {
  const [query, setQuery] = useState('');
  const [attachment, setAttachment] = useState<AttachedDocument | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  // Helper: get the current session's access token to attach to API calls
  const getAuthHeader = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('No active session. Please log in again.');
    return { Authorization: `Bearer ${token}` };
  };

  const handlePlusClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Guard against double-firing (e.g. React StrictMode in development)
    if (uploading) return;

    setUploading(true);
    setUploadError('');

    try {
      const headers = await getAuthHeader();
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`${apiUrl}/upload`, {
        method: 'POST',
        headers,
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || 'Upload failed.');
      }

      const data = await res.json();
      setAttachment({ document_id: data.document_id, filename: data.filename });
    } catch (err: any) {
      setUploadError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Permanently deletes the attached document from the backend
  // (FAISS index, Supabase record, and the file on disk).
  const handleRemoveAttachment = async () => {
    if (!attachment) return;
    const documentId = attachment.document_id;

    try {
      const headers = await getAuthHeader();
      await fetch(`${apiUrl}/documents/${documentId}`, {
        method: 'DELETE',
        headers,
      });
    } catch (err) {
      // Even if the delete call fails, we still clear the local preview
      // so the user isn't stuck with a broken attachment in the input.
    } finally {
      setAttachment(null);
      onDocumentDeleted?.(documentId);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim(), attachment);
      setQuery('');
      setAttachment(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (query.trim()) {
        onSearch(query.trim(), attachment);
        setQuery('');
        setAttachment(null);
      }
    }
  };

  return (
    <div className="w-full">
      {/* Attachment preview card — shown above the input once a file is uploaded */}
      <AnimatePresence>
        {(attachment || uploading) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mb-2 inline-flex items-center gap-2 bg-slate-800/60 border border-purple-500/30 rounded-xl px-3 py-2 relative group"
          >
            <div className="w-9 h-9 bg-purple-500/20 rounded-lg flex items-center justify-center shrink-0">
              <FileText size={16} className="text-purple-300" />
            </div>
            <span className="text-sm text-white max-w-[180px] truncate">
              {uploading ? 'Uploading...' : attachment?.filename}
            </span>

            {!uploading && (
              <button
                type="button"
                onClick={handleRemoveAttachment}
                className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 border border-purple-500/40 rounded-full flex items-center justify-center text-purple-300 hover:bg-red-500/80 hover:text-white transition-colors"
                aria-label="Remove document"
              >
                <X size={12} />
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {uploadError && (
        <p className="text-red-300 text-xs mb-2 ml-1">⚠️ {uploadError}</p>
      )}

      <form onSubmit={handleSubmit} className="w-full">
        <div className="relative">
          {/* Hidden file input, triggered by the "+" button */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.csv,.xlsx,.docx,.json"
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* "+" attach button */}
          <button
            type="button"
            onClick={handlePlusClick}
            disabled={disabled || uploading}
            title="Upload Documents"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-slate-700 border border-slate-500 text-white hover:bg-slate-600 hover:border-purple-400 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm z-10"
            aria-label="Upload Documents"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>

          {/* Search icon */}
          <div className="absolute left-14 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none">
            <Search size={18} />
          </div>

          {/* Input */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Ask anything about your documents…"
            className="w-full pl-24 pr-16 py-4 
                       bg-slate-800/50 backdrop-blur-sm 
                       border-2 border-gray-500/30 rounded-xl 
                       text-white placeholder-purple-300/40 
                       focus:outline-none focus:border-gray-500 
                       disabled:opacity-50 disabled:cursor-not-allowed 
                       transition-all text-sm"
          />

          {/* Send button */}
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="submit"
            disabled={disabled || !query.trim()}
            className="absolute right-2 top-1/2 -translate-y-1/2 
                       p-2.5 bg-gradient-to-r from-gray-600 to-gray-700 
                       rounded-lg text-white 
                       hover:shadow-lg hover:shadow-purple-500/40 
                       disabled:opacity-40 disabled:cursor-not-allowed 
                       transition-all"
          >
            <Send size={17} />
          </motion.button>
        </div>

        {/* Hint */}
        <p className="text-xs text-purple-400/40 mt-2 ml-1">
          Press Enter to search
        </p>
      </form>
    </div>
  );
}