// AuthPage.tsx
import { useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from './supabaseClient';
import type { Session } from '@supabase/supabase-js';

interface AuthPageProps {
  setSession: (session: Session | null) => void;
}

type Step = 'form' | 'otp';

export default function AuthPage({ setSession }: AuthPageProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [infoMsg, setInfoMsg] = useState('');

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  // ── STEP 1: Form Submit ──────────────────────────────
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfoMsg('');

    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address, e.g. example@gmail.com');
      return;
    }

    setLoading(true);

    try {
      if (isLogin) {
        // Login: password check karo
        const { error: loginError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (loginError) {
          setError(loginError.message);
          setLoading(false);
          return;
        }

        // Password sahi — session band karo pehle OTP bhejne se
        await supabase.auth.signOut();

        // Ab OTP bhejo
        const { error: otpError } = await supabase.auth.signInWithOtp({
          email,
          options: { shouldCreateUser: false },
        });

        if (otpError) {
          setError(otpError.message);
        } else {
          setInfoMsg('OTP sent to your email! Please check your inbox.');
          setStep('otp');
        }

      } else {
        // Signup
        const { error: signupError } = await supabase.auth.signUp({
          email,
          password,
        });

        if (signupError) {
          setError(signupError.message);
        } else {
          setInfoMsg('OTP sent to your email! Please verify to complete signup.');
          setStep('otp');
        }
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── STEP 2: OTP Verify ───────────────────────────────
  const handleOtpVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: otp,
        type: isLogin ? 'email' : 'signup',
      });

      if (verifyError) {
        setError('Invalid or expired OTP. Please try again.');
      } else {
        // OTP verify hua — session manually set karo
        const { data } = await supabase.auth.getSession();
        setSession(data.session);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Resend OTP ───────────────────────────────────────
  const handleResend = async () => {
    setError('');
    setInfoMsg('');
    setLoading(true);

    const { error: resendError } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    setLoading(false);
    if (resendError) {
      setError(resendError.message);
    } else {
      setInfoMsg('OTP resent! Check your inbox.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-slate-900 flex items-center justify-center px-4">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm bg-slate-900/60 backdrop-blur-md border border-purple-500/20 rounded-2xl p-8"
      >
        {/* Logo */}
        <div className="flex items-center justify-center mb-6">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-400 to-pink-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold">RAG</span>
          </div>
        </div>

        {/* ── OTP Step ── */}
        {step === 'otp' ? (
          <>
            <h2 className="text-2xl font-bold text-white text-center mb-1">
              Enter OTP
            </h2>
            <p className="text-purple-300 text-sm text-center mb-6">
              We sent a 8-digit code to <span className="text-pink-400">{email}</span>
            </p>

            <form onSubmit={handleOtpVerify} className="flex flex-col gap-4">
              <input
                type="text"
                placeholder="Enter 8-digit OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value)}
                maxLength={8}
                required
                className="bg-slate-800/60 border border-purple-500/30 rounded-lg px-4 py-2.5 text-white placeholder-gray-500 focus:outline-none focus:border-purple-400 text-center text-2xl tracking-widest"
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
                disabled={loading || otp.length < 6}
                className="bg-gradient-to-br from-purple-500 to-pink-600 text-white font-medium rounded-lg py-2.5 mt-2 disabled:opacity-50"
              >
                {loading ? 'Verifying...' : 'Verify OTP'}
              </button>
            </form>

            <div className="flex justify-between mt-4 text-sm">
              <button
                onClick={() => { setStep('form'); setOtp(''); setError(''); setInfoMsg(''); }}
                className="text-purple-300 hover:text-purple-200"
              >
                ← Change Email
              </button>
              <button
                onClick={handleResend}
                disabled={loading}
                className="text-pink-400 hover:text-pink-300 font-medium"
              >
                Resend OTP
              </button>
            </div>
          </>

        ) : (
          /* ── Form Step ── */
          <>
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
                onClick={() => { setIsLogin(!isLogin); setError(''); setInfoMsg(''); }}
                className="text-pink-400 font-medium underline"
              >
                {isLogin ? 'Sign Up' : 'Login'}
              </button>
            </p>
          </>
        )}
      </motion.div>
    </div>
  );
}
