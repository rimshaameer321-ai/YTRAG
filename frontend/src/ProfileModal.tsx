// ProfileModal.tsx
// Purpose: Modal component that shows the logged-in user's basic profile
// info — email and account creation date — read directly from the
// Supabase session. No extra API call is needed since this data already
// lives on the Supabase user object.

import { motion, AnimatePresence } from 'framer-motion';
import { User } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: Session | null;
  onLogout: () => void;
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function ProfileModal({ isOpen, onClose, session, onLogout }: ProfileModalProps) {
  const email = session?.user?.email || 'Unknown';
  const createdAt = formatDate(session?.user?.created_at);

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
            className="w-full max-w-sm bg-slate-900 border border-purple-500/20 rounded-2xl p-6"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-bold text-white">Your Profile</h2>
              <button
                onClick={onClose}
                className="text-purple-300 hover:text-white text-xl leading-none px-2"
              >
                ×
              </button>
            </div>

            {/* Avatar */}
            <div className="flex flex-col items-center mb-6">
              <div className="w-16 h-16 bg-gradient-to-br from-purple-400 to-pink-600 rounded-full flex items-center justify-center mb-3">
                <User size={28} className="text-white" />
              </div>
            </div>

            {/* Profile details */}
            <div className="flex flex-col gap-3">
              <div className="bg-slate-800/60 border border-purple-500/20 rounded-lg px-4 py-3">
                <p className="text-purple-300/70 text-xs mb-1">Email</p>
                <p className="text-white text-sm truncate">{email}</p>
              </div>

              <div className="bg-slate-800/60 border border-purple-500/20 rounded-lg px-4 py-3">
                <p className="text-purple-300/70 text-xs mb-1">Member Since</p>
                <p className="text-white text-sm">{createdAt}</p>
              </div>

              <button
                onClick={onLogout}
                className="text-sm text-red-300 border border-red-500/30 rounded-lg px-3 py-2 hover:bg-red-500/10 transition-colors mt-1"
              >
                Logout
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
