import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useNavigate } from 'react-router-dom';
import { BookOpen, LogOut } from 'lucide-react';
import { cn } from './lib/utils';
import ScannerPage from './pages/ScannerPage';
import LibraryPage from './pages/LibraryPage';
import AuthPage, { checkSession, clearSession } from './pages/AuthPage';
import CatalogPage from './pages/CatalogPage';

export interface ExtractedData {
  title: string | null;
  author: string | null;
  year: string | null;
  publisher?: string | null;
  isbn?: string | null;
  ddc?: string | null;
  language?: string | null;
  physical?: string | null;
  pageCount?: string | null;
  dimensions?: string | null;
  summary?: string | null;
  toc?: string | null;
  subjects?: string[];
  rawOcrText?: string;
}

export interface SavedBook {
  id: number;
  title: string;
  author: string;
  publishYear: number | null;
  isbn?: string;
  ddc?: string;
  publisher?: string;
  language?: string;
  physical?: string;
  pageCount?: string;
  dimensions?: string;
  summary?: string;
  toc?: string;
  subjects?: string;
}

interface LoggedInUser {
  username: string;
  email: string;
}

function NavLinks({ onCatalogClick }: { onCatalogClick: () => void }) {
  const location = useLocation();

  const tabs = [
    { path: '/',        label: 'AI Scanner' },
    { path: '/catalog', label: 'Biên mục'  },
    { path: '/library', label: 'Thư viện'  },
  ];

  return (
    <div className="flex bg-neutral-100 p-1 rounded-lg">
      {tabs.map(tab =>
        tab.path === '/catalog' ? (
          <button
            key={tab.path}
            onClick={onCatalogClick}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              location.pathname === tab.path
                ? 'bg-white shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            )}
          >
            {tab.label}
          </button>
        ) : (
          <Link
            key={tab.path}
            to={tab.path}
            className={cn(
              'px-4 py-1.5 text-sm font-medium rounded-md transition-colors',
              location.pathname === tab.path
                ? 'bg-white shadow-sm'
                : 'text-neutral-500 hover:text-neutral-700'
            )}
          >
            {tab.label}
          </Link>
        )
      )}
    </div>
  );
}

function MainApp({ user, onLogout }: { user: LoggedInUser; onLogout: () => void }) {
  return (
    <BrowserRouter>
      <MainAppInner user={user} onLogout={onLogout} />
    </BrowserRouter>
  );
}

function MainAppInner({ user, onLogout }: { user: LoggedInUser; onLogout: () => void }) {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 font-sans">
      <header className="bg-white border-b border-neutral-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight">AI LibScanner</h1>
          </div>
          <NavLinks onCatalogClick={() => navigate('/catalog')} />
          <div className="flex items-center gap-3">
            <span className="text-sm text-neutral-500 hidden sm:block">
              Xin chào, <span className="font-semibold text-neutral-800">{user.username}</span>
            </span>
            <button
              onClick={onLogout}
              title="Đăng xuất"
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-neutral-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-neutral-200 hover:border-red-200"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Đăng xuất</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-8">
        <Routes>
          <Route path="/" element={<ScannerPage />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route
            path="/catalog"
            element={<CatalogPage />}
          />
        </Routes>
      </main>

    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<LoggedInUser | null>(() => checkSession());

  const handleLogin = (loggedInUser: LoggedInUser) => setUser(loggedInUser);
  const handleLogout = () => { clearSession(); setUser(null); };

  if (!user) return <AuthPage onLogin={handleLogin} />;
  return <MainApp user={user} onLogout={handleLogout} />;
}
