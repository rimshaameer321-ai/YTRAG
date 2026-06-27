// ProfileModal.tsx
// Updated: Name from email shown in avatar + profile details.
// Avatar mein letter dikhta hai sirf User icon nahi.
// CHANGED: getDisplayName ab export hai taake App.tsx (sidebar footer) bhi use kar sake.

import { motion, AnimatePresence } from 'framer-motion';
import type { Session } from '@supabase/supabase-js';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  session: Session | null;
  onLogout: () => void;
}

function formatDate(dateString: string | undefined): string {
  if (!dateString) return 'Unknown';
  return new Date(dateString).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });
}

/** Email se display name nikalo: "rimsha.ameer@gmail.com" → "Rimsha Ameer" */
export function getDisplayName(session: Session | null): string {
  if (!session) return '';
  const fullName = session.user.user_metadata?.full_name;
  if (fullName) return fullName;
  const localPart = (session.user.email ?? '').split('@')[0];
  return localPart
    .split(/[._]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export default function ProfileModal({ isOpen, onClose, session, onLogout }: ProfileModalProps) {
  const email = session?.user?.email || 'Unknown';
  const createdAt = formatDate(session?.user?.created_at);
  const displayName = getDisplayName(session);
  const avatarLetter = displayName.charAt(0).toUpperCase();

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
            className="w-full max-w-sm bg-[#1e1e1e] border border-white/10 rounded-2xl p-6"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-white">Profile</h2>
              <button onClick={onClose} className="text-gray-400 hover:text-white text-xl leading-none px-2">
                ×
              </button>
            </div>

            {/* Avatar + name */}
            <div className="flex flex-col items-center mb-6">
              {/* Avatar circle with first letter of name */}
              <div className="w-16 h-16 bg-gradient-to-br from-purple-400 to-pink-600 rounded-full flex items-center justify-center mb-3">
                <span className="text-white font-bold text-2xl">{avatarLetter}</span>
              </div>
              {/* Display name below avatar */}
              <p className="text-white font-semibold text-base">{displayName}</p>
              <p className="text-gray-500 text-xs mt-1">{email}</p>
            </div>

            {/* Details */}
            <div className="flex flex-col gap-3">
              <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                <p className="text-gray-500 text-xs mb-1">Email</p>
                <p className="text-white text-sm truncate">{email}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-lg px-4 py-3">
                <p className="text-gray-500 text-xs mb-1">Member Since</p>
                <p className="text-white text-sm">{createdAt}</p>
              </div>
              <button
                onClick={onLogout}
                className="text-sm text-red-400 border border-red-500/30 rounded-lg px-3 py-2 hover:bg-red-500/10 transition-colors mt-1"
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
