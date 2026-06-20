import { motion } from 'framer-motion';

export default function LoadingAnimation() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col items-center justify-center py-16 gap-6"
    >
      <div className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            animate={{ y: [0, -20, 0] }}
            transition={{
              duration: 0.6,
              delay: i * 0.1,
              repeat: Infinity,
            }}
            className="w-3 h-3 bg-gradient-to-r from-purple-400 to-pink-600 rounded-full"
          />
        ))}
      </div>
      <p className="text-purple-300 text-sm font-medium">Searching documents and generating answer...</p>
    </motion.div>
  );
}