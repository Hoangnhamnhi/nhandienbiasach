import React, { useState } from 'react';
import { BookOpen, Eye, EyeOff, Loader2, Lock, User, Mail } from 'lucide-react';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
}

interface AuthPageProps {
  onLogin: (user: AuthUser) => void;
}

type AuthMode = 'login' | 'register';

const SESSION_KEY = 'ai_library_session';

export function checkSession(): AuthUser | null {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}

export function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

export default function AuthPage({ onLogin }: AuthPageProps) {
  const [mode, setMode]         = useState<AuthMode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  const switchMode = (m: AuthMode) => {
    setMode(m); setUsername(''); setEmail(''); setPassword('');
    setError(''); setSuccess('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');

    if (mode === 'register') {
      if (!username.trim() || !email.trim() || !password.trim())
        return setError('Vui lòng điền đầy đủ thông tin.');
      if (password.length < 6)
        return setError('Mật khẩu phải có ít nhất 6 ký tự.');
    } else {
      if (!username.trim() || !password.trim())
        return setError('Vui lòng nhập tên đăng nhập và mật khẩu.');
    }

    setLoading(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = mode === 'register'
        ? { username: username.trim(), email: email.trim(), password }
        : { username: username.trim(), password };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'Đã xảy ra lỗi, vui lòng thử lại.');
        return;
      }

      if (mode === 'register') {
        setSuccess('Đăng ký thành công! Đang đăng nhập...');
        await new Promise(r => setTimeout(r, 700));
      }

      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
      onLogin(data as AuthUser);
    } catch {
      setError('Không thể kết nối máy chủ. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center px-4">
      {/* Background decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-32 -right-32 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #2563eb, transparent)' }} />
        <div className="absolute -bottom-32 -left-32 w-96 h-96 rounded-full opacity-5"
          style={{ background: 'radial-gradient(circle, #2563eb, transparent)' }} />
        <div className="absolute inset-0 opacity-[0.025]" style={{
          backgroundImage: 'linear-gradient(#000 1px, transparent 1px), linear-gradient(90deg, #000 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }} />
      </div>

      <div className="w-full max-w-md relative">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 shadow-lg shadow-blue-600/25 mb-4">
            <BookOpen className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">AI LibraryScanner</h1>
          <p className="text-neutral-500 text-sm mt-1">Hệ thống quản lý thư viện thông minh</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl shadow-neutral-200/80 border border-neutral-100 overflow-hidden">
          {/* Tab switcher */}
          <div className="flex border-b border-neutral-100">
            {(['login', 'register'] as AuthMode[]).map(m => (
              <button key={m} type="button" onClick={() => switchMode(m)}
                className={`flex-1 py-4 text-sm font-semibold transition-colors ${
                  mode === m
                    ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50/30'
                    : 'text-neutral-400 hover:text-neutral-600'
                }`}>
                {m === 'login' ? 'Đăng nhập' : 'Đăng ký'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="p-8 space-y-5">
            {/* Username — always shown */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-neutral-700">Tên đăng nhập</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="Nhập tên đăng nhập" autoComplete="username"
                  className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-neutral-50/50" />
              </div>
            </div>

            {/* Email — register only */}
            {mode === 'register' && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-neutral-700">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                    placeholder="example@email.com" autoComplete="email"
                    className="w-full pl-10 pr-4 py-2.5 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-neutral-50/50" />
                </div>
              </div>
            )}

            {/* Password */}
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-neutral-700">Mật khẩu</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
                <input type={showPass ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? 'Tối thiểu 6 ký tự' : 'Nhập mật khẩu'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  className="w-full pl-10 pr-10 py-2.5 border border-neutral-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all bg-neutral-50/50" />
                <button type="button" onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Feedback */}
            {error && (
              <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                {error}
              </div>
            )}
            {success && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                {success}
              </div>
            )}

            {/* Submit */}
            <button type="submit" disabled={loading}
              className="w-full flex items-center justify-center gap-2 py-3 bg-blue-600 text-white rounded-xl font-semibold text-sm hover:bg-blue-700 active:scale-[0.98] transition-all shadow-sm shadow-blue-600/20 disabled:opacity-60 disabled:cursor-not-allowed mt-2">
              {loading
                ? <><Loader2 className="w-4 h-4 animate-spin" /> Đang xử lý...</>
                : mode === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'
              }
            </button>

            <p className="text-center text-sm text-neutral-500 pt-1">
              {mode === 'login' ? (
                <>Chưa có tài khoản?{' '}
                  <button type="button" onClick={() => switchMode('register')}
                    className="text-blue-600 font-medium hover:underline">Đăng ký ngay</button>
                </>
              ) : (
                <>Đã có tài khoản?{' '}
                  <button type="button" onClick={() => switchMode('login')}
                    className="text-blue-600 font-medium hover:underline">Đăng nhập</button>
                </>
              )}
            </p>
          </form>
        </div>

        <p className="text-center text-xs text-neutral-400 mt-6">
          © {new Date().getFullYear()} AI LibraryScanner · Dành cho thủ thư
        </p>
      </div>
    </div>
  );
}
