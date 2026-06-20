import { useState } from 'react';
import { motion } from 'framer-motion';
import { Search, Send } from 'lucide-react';

interface SearchBarProps {
  onSearch: (query: string) => void;
  disabled: boolean;
}

export default function SearchBar({ onSearch, disabled }: SearchBarProps) {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (query.trim()) {
      onSearch(query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (query.trim()) onSearch(query.trim());
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        {/* Search icon */}
        <div className="absolute left-4 top-1/2 -translate-y-1/2 text-purple-400 pointer-events-none">
          <Search size={20} />
        </div>

        {/* Input */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Ask anything about your documents…"
          className="w-full pl-12 pr-16 py-4 
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
  );
}
