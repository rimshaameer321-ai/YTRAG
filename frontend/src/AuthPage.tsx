// AuthPage.tsx
// Purpose: Login and Signup on one page — toggle switches between them.
// On success, onAuthSuccess() is called so App.tsx can show the main search UI.
// Extra: validates email format before submit (must have proper domain + extension).

import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from './supabaseClient';

interface AuthPageProps {
  onAuthSuccess: () => void;
}

export default function AuthPage({ onAuthSuccess }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true); // true = Login, false = Signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');

    // Email format check — must have a proper domain and extension (.com, .org, etc.)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address, e.g. example@gmail.com');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        // ---- LOGIN ----
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginError) {
          setError(loginError.message);
        } else {
          onAuthSuccess();
        }
      } else {
        // ---- SIGNUP ----
        const { error: signupError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (signupError) {
          setError(signupError.message);
        } else {
          setInfoMsg('Account created successfully! You can log in now.');
          setIsLogin(true);
        }
      }
    } catch (err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-slate-900/60 backdrop-blur-md border border-purple-500/20 rounded-2xl p-8"
      >
        <div className="flex items-center justify-center mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-pink-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold">RAG</span>
          </div>
        </div>

        <h2 className="text-2xl font-bold text-white text-center mb-1">
          {isLogin ? 'Login' : 'Sign Up'}
        </h2>
        <p className="text-purple-300 text-sm text-center mb-6">
          {isLogin ? 'Welcome back, please sign in' : 'Create a new account'}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="bg-slate-800/60 border border-purple-500/30 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            className="bg-slate-800/60 border border-purple-500/30 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400"
          />

          {error && (
            <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
              ⚠️ {error}
            </p>
          )}
          {infoMsg && (
            <p className="text-green-300 text-sm bg-green-500/10 border border-green-500/30 rounded-lg px-3 py-2">
              ✅ {infoMsg}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="bg-gradient-to-br from-purple-500 to-pink-600 text-white font-medium rounded-lg py-2.5 mt-2 disabled:opacity-50"
          >
            {loading ? 'Please wait...' : isLogin ? 'Login' : 'Sign Up'}
          </button>
        </form>

        <p className="text-center text-sm text-purple-300 mt-5">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
              setInfoMsg('');
            }}
            className="text-pink-400 font-medium underline"
          >
            {isLogin ? 'Sign Up' : 'Login'}
          </button>
        </p>
      </motion.div>
    </div>
  );
}