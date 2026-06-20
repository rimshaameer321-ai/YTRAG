import { motion } from 'framer-motion';
import { FileText, ExternalLink } from 'lucide-react';

interface DocumentReferencesProps {
  documents: Array<{ title?: string; source?: string; excerpt?: string }>;
}

export default function DocumentReferences({ documents }: DocumentReferencesProps) {
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-slate-800/30 backdrop-blur-sm border border-purple-500/20 rounded-xl p-6"
    >
      <h3 className="text-lg font-bold text-purple-300 mb-4 flex items-center gap-2">
        <FileText size={20} />
        Source Documents
      </h3>
      
      <div className="space-y-3">
        {documents.map((doc, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="bg-slate-900/50 border border-purple-500/10 rounded-lg p-3 hover:border-purple-500/30 transition-all"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1">
                <p className="text-sm font-semibold text-purple-300">
                  {doc.title || `Document ${idx + 1}`}
                </p>
                {doc.excerpt && (
                  <p className="text-xs text-slate-400 mt-1 line-clamp-2">
                    {doc.excerpt}
                  </p>
                )}
              </div>
              <ExternalLink size={16} className="text-purple-400 flex-shrink-0" />
            </div>
          </motion.div>
        ))}
      </div>
    </motion.div>
  );
}