// DocumentManager.tsx
// Purpose: Main document hub — the central place to upload, view, and
// delete the logged-in user's documents.
// NEW: Upload button added here so this panel is the primary place to
//      manage documents (uploading inside individual chats via SearchBar
//      still works too — both write to the same backend document list).
// Deleting a document removes its chunks from the FAISS vector store,
// removes its record from Supabase, and deletes the file from disk —
// once deleted, the user will no longer be able to search within it.

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FileText, Trash2, Plus, Upload } from 'lucide-react';
import { supabase } from './supabaseClient';

interface DocumentRecord {
  id: string;
  filename: string;
  created_at: string;
}

interface DocumentManagerProps {
  isOpen: boolean;
  onClose: () => void;
  // NEW: parent (App.tsx) ko batane ke liye ke documents list badal gayi hai,
  // taake open chats ke andar SearchBar ki doc-toggle list bhi refresh ho sake
  onDocumentsChanged?: () => void;
}

export default function DocumentManager({ isOpen, onClose, onDocumentsChanged }: DocumentManagerProps) {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState('');

  // NEW: upload-related state — same pattern used in SearchBar.tsx
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // NEW: open the native file picker
  const handlePlusClick = () => {
    fileInputRef.current?.click();
  };

  // NEW: upload a single file to the backend, returns the new doc record
  const uploadSingleFile = async (file: File): Promise<DocumentRecord> => {
    const headers = await getAuthHeader();
    const formData = new FormData();
    formData.append('file', file);

    const res = await fetch(`${apiUrl}/upload`, {
      method: 'POST',
      headers, // Content-Type set automatically by the browser for FormData
      body: formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.detail || `Upload failed for ${file.name}.`);
    }

    const data = await res.json();
    return {
      id: data.document_id,
      filename: data.filename,
      created_at: new Date().toISOString(),
    };
  };

  // NEW: handle one or many files selected from the picker — uploads them
  // one-by-one in sequence, same approach as SearchBar.tsx, so multiple
  // files don't overwrite each other and all end up in the list.
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (uploading) return;

    const fileList = Array.from(files);

    setUploading(true);
    setError('');
    setUploadProgress({ done: 0, total: fileList.length });

    const newlyUploaded: DocumentRecord[] = [];
    const failedNames: string[] = [];

    for (let i = 0; i < fileList.length; i++) {
      try {
        const doc = await uploadSingleFile(fileList[i]);
        newlyUploaded.push(doc);
      } catch {
        failedNames.push(fileList[i].name);
      } finally {
        setUploadProgress({ done: i + 1, total: fileList.length });
      }
    }

    if (newlyUploaded.length > 0) {
      setDocuments(prev => [...prev, ...newlyUploaded]);
      onDocumentsChanged?.(); // Open chats ko batao ke list badal gayi
    }

    if (failedNames.length > 0) {
      setError(
        failedNames.length === 1
          ? `Upload failed for ${failedNames[0]}.`
          : `${failedNames.length} files failed to upload.`
      );
    }

    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

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
      onDocumentsChanged?.(); // Open chats ko batao ke list badal gayi
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
              Upload documents here to use them across any chat. You can delete a document at any time.
            </p>

            {/* NEW: Upload button + hidden file input — this is the hub's upload entry point */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.txt,.csv,.xlsx,.docx,.json"
              multiple
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              type="button"
              onClick={handlePlusClick}
              disabled={uploading}
              className="mb-4 flex items-center justify-center gap-2 w-full border-2 border-dashed border-purple-500/30 rounded-xl py-3 text-purple-300 hover:border-purple-400/60 hover:bg-purple-500/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
            >
              {uploading ? (
                <>
                  <Upload size={16} className="animate-pulse" />
                  {uploadProgress && uploadProgress.total > 1
                    ? `Uploading ${uploadProgress.done}/${uploadProgress.total}...`
                    : 'Uploading...'}
                </>
              ) : (
                <>
                  <Plus size={16} />
                  Upload documents
                </>
              )}
            </button>

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
