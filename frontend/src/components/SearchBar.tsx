// SearchBar.tsx
// Main input bar for asking questions.
// NEW: Shows a list of uploaded documents with enable/disable toggles.
//      Only enabled documents are searched when the user sends a query.
// CHANGED: File input now accepts multiple files; they upload one-by-one in sequence.
// Existing: inline file upload, attachment preview, send on Enter.

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Send, Plus, FileText, X, ChevronUp, ToggleLeft, ToggleRight } from 'lucide-react';
import { supabase } from '../supabaseClient';

export interface AttachedDocument {
  document_id: string;
  filename: string;
}

interface UploadedDoc {
  id: string;         // document_id from backend
  filename: string;   // original filename
  enabled: boolean;   // NEW: whether this doc is included in searches
}

interface SearchBarProps {
  onSearch: (
    query: string,
    attachments: AttachedDocument[],
    enabledDocIds: string[] | null  // NEW: null means "use all docs"
  ) => void;
  disabled: boolean;
  onDocumentDeleted?: (documentId: string) => void;
}

export default function SearchBar({ onSearch, disabled, onDocumentDeleted }: SearchBarProps) {
  const [query, setQuery] = useState('');
  // CHANGED: ab ek se zyada staged attachments rakh sakte hain (grid cards mein dikhte hain)
  const [attachments, setAttachments] = useState<AttachedDocument[]>([]);
  const [uploading, setUploading] = useState(false);
  // CHANGED: kitni files total/kitni ho chuki hain, "Uploading 2/5..." jaisa dikhane ke liye
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [uploadedDocs, setUploadedDocs] = useState<UploadedDoc[]>([]);  // NEW: list of all user docs
  const [docsMenuOpen, setDocsMenuOpen] = useState(false);              // NEW: toggle doc panel visibility
  const fileInputRef = useRef<HTMLInputElement>(null);

  const apiUrl = process.env.REACT_APP_API_URL || 'http://localhost:8000';

  // Helper: get JWT token from the current Supabase session
  const getAuthHeader = async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('No active session. Please log in again.');
    return { Authorization: `Bearer ${token}` };
  };

  // NEW: Fetch all uploaded documents for this user on component mount
  useEffect(() => {
    const fetchDocs = async () => {
      try {
        const headers = await getAuthHeader();
        const res = await fetch(`${apiUrl}/documents`, { headers });  // GET /documents
        if (!res.ok) return;
        const data = await res.json();
        // Map the backend response to UploadedDoc shape, all enabled by default
        setUploadedDocs(
          (data.documents ?? []).map((d: any) => ({
            id: d.id,
            filename: d.filename,
            enabled: true,  // All docs start as enabled
          }))
        );
      } catch {
        // Silently ignore — user just won't see the doc toggle panel
      }
    };
    fetchDocs();
  }, []); // Empty array = run once on mount

  // NEW: Toggle a document's enabled/disabled state
  const toggleDoc = (docId: string) => {
    setUploadedDocs(prev =>
      prev.map(doc =>
        doc.id === docId
          ? { ...doc, enabled: !doc.enabled }  // Flip the enabled flag
          : doc
      )
    );
  };

  // NEW: Compute which document IDs are currently enabled
  // Returns null if ALL documents are enabled (tell backend "use everything")
  // Returns an array of IDs if only SOME are enabled (backend filters by this list)
  const getEnabledDocIds = (): string[] | null => {
    const enabledIds = uploadedDocs.filter(d => d.enabled).map(d => d.id);
    return enabledIds.length === uploadedDocs.length ? null : enabledIds;
    // null = all docs enabled = no filter needed
    // array = subset of docs = backend will only search these
  };

  const handlePlusClick = () => {
    fileInputRef.current?.click();  // Programmatically open the file picker dialog
  };

  // Helper: upload a single file to the backend, returns the new doc info
  const uploadSingleFile = async (file: File): Promise<UploadedDoc> => {
    const headers = await getAuthHeader();
    const formData = new FormData();
    formData.append('file', file);  // Attach the file to a multipart form

    const res = await fetch(`${apiUrl}/upload`, {
      method: 'POST',
      headers,           // Only Authorization header; Content-Type is set by browser for FormData
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Upload failed for ${file.name}.`);
    }

    const data = await res.json();
    return { id: data.document_id, filename: data.filename, enabled: true };
  };

  // CHANGED: Ab multiple files handle karta hai — ek-ek karke sequentially upload hoti hain
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (uploading) return;  // Guard against double-fire in React StrictMode

    const fileList = Array.from(files); // FileList -> array, taake loop kar sakein

    setUploading(true);
    setUploadError('');
    setUploadProgress({ done: 0, total: fileList.length });

    const newlyUploaded: UploadedDoc[] = [];
    const failedNames: string[] = [];

    // Har file ek ke baad ek upload karo (sequential), taake server pe ek waqt
    // mein ek hi request jaye aur progress count sahi dikhe
    for (let i = 0; i < fileList.length; i++) {
      try {
        const uploadedDoc = await uploadSingleFile(fileList[i]);
        newlyUploaded.push(uploadedDoc);
      } catch (err: any) {
        failedNames.push(fileList[i].name);
      } finally {
        setUploadProgress({ done: i + 1, total: fileList.length });
      }
    }

    // Saari successful uploads ko docs list mein add karo
    if (newlyUploaded.length > 0) {
      setUploadedDocs(prev => [...prev, ...newlyUploaded]);
      // CHANGED: har successful upload ko staged attachments list mein add karo (overwrite nahi)
      setAttachments(prev => [
        ...prev,
        ...newlyUploaded.map(d => ({ document_id: d.id, filename: d.filename })),
      ]);
    }

    if (failedNames.length > 0) {
      setUploadError(
        failedNames.length === 1
          ? `Upload failed for ${failedNames[0]}.`
          : `${failedNames.length} files failed to upload.`
      );
    }

    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';  // Reset file input
  };

  // Delete a specific attached document from backend + clear from UI
  // CHANGED: ab documentId parameter leta hai (pehle sirf ek attachment tha)
  const handleRemoveAttachment = async (documentId: string) => {
    try {
      const headers = await getAuthHeader();
      await fetch(`${apiUrl}/documents/${documentId}`, {
        method: 'DELETE',
        headers,
      });
    } catch {
      // Even if server delete fails, clear from UI so user isn't stuck
    } finally {
      setAttachments(prev => prev.filter(a => a.document_id !== documentId));
      onDocumentDeleted?.(documentId);  // Notify parent (App.tsx) to clean up messages
      // NEW: Also remove from the docs toggle list
      setUploadedDocs(prev => prev.filter(d => d.id !== documentId));
    }
  };

  // Called when user presses Enter or clicks Send
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();  // Prevent default form submission (page reload)
    if (query.trim()) {
      onSearch(query.trim(), attachments, getEnabledDocIds());  // CHANGED: pass full attachments array
      setQuery('');
      setAttachments([]);
    }
  };

  // Also submit on Enter (but not Shift+Enter)
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (query.trim()) {
        onSearch(query.trim(), attachments, getEnabledDocIds());  // CHANGED: pass full attachments array
        setQuery('');
        setAttachments([]);
      }
    }
  };

  return (
    <div className="w-full">

      {/* NEW: Document enable/disable panel */}
      <AnimatePresence>
        {docsMenuOpen && uploadedDocs.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mb-3 bg-slate-800/80 border border-purple-500/30 rounded-xl p-3"
          >
            <p className="text-xs text-purple-300 font-semibold mb-2">
              Toggle Documents — only enabled docs will be searched
            </p>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto">
              {uploadedDocs.map(doc => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-700/50"
                >
                  <div className="flex items-center gap-2">
                    <FileText size={13} className="text-purple-400 shrink-0" />
                    <span className={`text-xs truncate max-w-[180px] ${doc.enabled ? 'text-white' : 'text-slate-500 line-through'}`}>
                      {doc.filename}
                    </span>
                  </div>
                  {/* Toggle button */}
                  <button
                    onClick={() => toggleDoc(doc.id)}
                    className={`shrink-0 transition-colors ${doc.enabled ? 'text-purple-400' : 'text-slate-600'}`}
                    title={doc.enabled ? 'Disable this document' : 'Enable this document'}
                  >
                    {doc.enabled
                      ? <ToggleRight size={20} />   // Enabled icon
                      : <ToggleLeft size={20} />    // Disabled icon
                    }
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Attachment preview — CHANGED: ab grid cards mein, ek se zyada files dikhati hain */}
      <AnimatePresence>
        {(attachments.length > 0 || uploading) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="mb-3 flex flex-wrap gap-2"
          >
            {/* Har staged file ka apna card — filename + extension badge */}
            {attachments.map(doc => {
              const ext = doc.filename.split('.').pop()?.toUpperCase() || 'FILE';
              return (
                <div
                  key={doc.document_id}
                  className="relative group w-36 bg-slate-800/60 border border-purple-500/30 rounded-xl p-3 flex flex-col justify-between"
                >
                  <span className="text-xs text-white leading-snug line-clamp-3 break-words mb-2">
                    {doc.filename}
                  </span>
                  <span className="text-[10px] font-semibold text-purple-300 bg-purple-500/15 border border-purple-500/30 rounded px-1.5 py-0.5 w-fit">
                    {ext}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveAttachment(doc.document_id)}
                    className="absolute -top-2 -right-2 w-5 h-5 bg-slate-700 border border-purple-500/40 rounded-full flex items-center justify-center text-purple-300 opacity-0 group-hover:opacity-100 hover:bg-red-500/80 hover:text-white transition-all"
                    aria-label="Remove document"
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}

            {/* Uploading placeholder card — sirf jab files upload ho rahi hon */}
            {uploading && (
              <div className="w-36 bg-slate-800/60 border border-purple-500/30 rounded-xl p-3 flex flex-col items-center justify-center gap-1">
                <FileText size={16} className="text-purple-300" />
                <span className="text-xs text-purple-300">
                  {uploadProgress && uploadProgress.total > 1
                    ? `Uploading ${uploadProgress.done}/${uploadProgress.total}...`
                    : 'Uploading...'}
                </span>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload error */}
      {uploadError && (
        <p className="text-red-300 text-xs mb-2 ml-1">⚠️ {uploadError}</p>
      )}

      <form onSubmit={handleSubmit} className="w-full">
        <div className="relative">
          {/* Hidden file input — CHANGED: now accepts multiple files at once */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.txt,.csv,.xlsx,.docx,.json"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />

          {/* "+" upload button */}
          <button
            type="button"
            onClick={handlePlusClick}
            disabled={disabled || uploading}
            title="Upload documents"
            className="absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 flex items-center justify-center bg-slate-700 border border-slate-500 text-white hover:bg-slate-600 hover:border-purple-400 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm z-10"
          >
            <Plus size={18} strokeWidth={2.5} />
          </button>

          {/* Search icon (decorative) */}
          <div className="absolute left-14 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none">
            <Search size={18} />
          </div>

          {/* Text input */}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            placeholder="Ask anything about your documents…"
            className="w-full pl-24 pr-24 py-4 
                       bg-slate-800/50 backdrop-blur-sm 
                       border-2 border-gray-500/30 rounded-xl 
                       text-white placeholder-purple-300/40 
                       focus:outline-none focus:border-gray-500 
                       disabled:opacity-50 disabled:cursor-not-allowed 
                       transition-all text-sm"
          />

          {/* Right side buttons */}
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">

            {/* NEW: Docs toggle button */}
            {uploadedDocs.length > 0 && (
              <button
                type="button"
                onClick={() => setDocsMenuOpen(prev => !prev)}
                title="Toggle documents"
                className={`p-2 rounded-lg transition-colors
                  ${docsMenuOpen
                    ? 'bg-purple-500/40 text-purple-200'
                    : 'text-purple-400 hover:bg-purple-500/20'
                  }`}
              >
                <ChevronUp
                  size={16}
                  className={`transition-transform ${docsMenuOpen ? 'rotate-180' : ''}`}
                />
              </button>
            )}

            {/* Send button */}
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              type="submit"
              disabled={disabled || !query.trim()}
              className="p-2.5 bg-gradient-to-r from-gray-600 to-gray-700 
                         rounded-lg text-white 
                         hover:shadow-lg hover:shadow-purple-500/40 
                         disabled:opacity-40 disabled:cursor-not-allowed 
                         transition-all"
            >
              <Send size={17} />
            </motion.button>
          </div>
        </div>

        {/* Hint text */}
        <p className="text-xs text-purple-400/40 mt-2 ml-1">
          Press Enter to search
          {uploadedDocs.length > 0 && (
            <span className="ml-2">
              · {uploadedDocs.filter(d => d.enabled).length}/{uploadedDocs.length} docs active
            </span>
          )}
        </p>
      </form>
    </div>
  );
}
