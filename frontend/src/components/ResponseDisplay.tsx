import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';

interface ResponseDisplayProps {
  markdown: string;
}

export default function ResponseDisplay({ markdown }: ResponseDisplayProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-slate-800/30 backdrop-blur-sm border border-purple-500/20 rounded-xl p-6 text-white"
    >
      <h2 className="text-xl font-bold mb-4 text-purple-300">Answer</h2>
      <div className="prose prose-invert max-w-none">
        <ReactMarkdown
          components={{
            h1: ({ node, ...props }) => <h1 className="text-2xl font-bold mt-6 mb-3 text-purple-300" {...props} />,
            h2: ({ node, ...props }) => <h2 className="text-xl font-bold mt-5 mb-2 text-purple-300" {...props} />,
            h3: ({ node, ...props }) => <h3 className="text-lg font-bold mt-4 mb-2 text-purple-200" {...props} />,
            p: ({ node, ...props }) => <p className="mb-3 text-slate-200 leading-relaxed" {...props} />,
            ul: ({ node, ...props }) => <ul className="list-disc list-inside mb-3 text-slate-200 space-y-1" {...props} />,
            ol: ({ node, ...props }) => <ol className="list-decimal list-inside mb-3 text-slate-200 space-y-1" {...props} />,
            li: ({ node, ...props }) => <li className="ml-2" {...props} />,
            code: ({ node, inline, ...props }: any) =>
              inline ? (
                <code className="bg-purple-500/20 px-2 py-1 rounded text-purple-300 font-mono text-sm" {...props} />
              ) : (
                <code className="block bg-slate-900/50 p-3 rounded-lg text-purple-300 font-mono text-sm overflow-x-auto mb-3" {...props} />
              ),
            blockquote: ({ node, ...props }) => (
              <blockquote className="border-l-4 border-purple-500 pl-4 my-3 italic text-slate-300" {...props} />
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      </div>
    </motion.div>
  );
}