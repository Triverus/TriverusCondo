import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { clearCRMCache } from './lib/crmCache.ts';
import { CRMProvider } from './lib/crmStore.tsx';
import LeadsModule from './components/LeadsModule.tsx';
import FollowUpsModule from './components/FollowUpsModule.tsx';

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: string | null;
}

const CACHED_PROFILE_KEY = 'triverus:cached-profile';

export function loadCachedProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(CACHED_PROFILE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveCachedProfile(p: UserProfile): void {
  try {
    localStorage.setItem(CACHED_PROFILE_KEY, JSON.stringify(p));
  } catch {}
}

export function clearCachedProfile(): void {
  try {
    localStorage.removeItem(CACHED_PROFILE_KEY);
  } catch {}
}

export default function App() {
  const initialProfile = useRef<UserProfile | null>(loadCachedProfile());
  const hasCachedSession = Boolean(initialProfile.current);

  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(!hasCachedSession);
  const [path, setPath] = useState<string>(() => window.location.pathname);

  // Central state for profile - hydrated synchronously from cache
  const [profile, setProfile] = useState<UserProfile | null>(() => initialProfile.current);
  const [profileLoading, setProfileLoading] = useState<boolean>(false);
  const [profileQueryError, setProfileQueryError] = useState<{
    message: string;
    code?: string;
    details?: string;
    hint?: string;
  } | null>(null);
  const [profileNotFound, setProfileNotFound] = useState<boolean>(false);

  // Form states for login
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Cross-module navigation state (e.g. open lead from followups)
  const [targetLeadIdForView, setTargetLeadIdForView] = useState<string | null>(null);

  // State for mobile drawer
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Synchronize route navigation
  const navigate = (newPath: string) => {
    if (window.location.pathname !== newPath) {
      window.history.pushState({}, '', newPath);
    }
    setPath(newPath);
    setMobileMenuOpen(false);
  };

  useEffect(() => {
    const handlePopState = () => {
      setPath(window.location.pathname);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const profileRef = useRef<UserProfile | null>(profile);
  profileRef.current = profile;
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  // Fetch profile from public.profiles with diagnostic logging (Silent SWR background revalidation)
  const fetchProfile = useCallback(async (userId: string, isBackground = false) => {
    if (!isBackground && !profileRef.current) {
      setProfileLoading(true);
    }
    setProfileQueryError(null);
    setProfileNotFound(false);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('Aviso de rede na consulta a public.profiles:', error.message);
        // Fallback resiliente: nunca trava a tela com erro fatal em falha de conexão/offline
        const cached = loadCachedProfile();
        if (cached && cached.id === userId) {
          setProfile(cached);
        } else if (!profileRef.current) {
          const fallbackUser: UserProfile = {
            id: userId,
            full_name: sessionRef.current?.user?.user_metadata?.full_name || sessionRef.current?.user?.email?.split('@')[0] || 'Usuário',
            role: 'Administrador',
          };
          setProfile(fallbackUser);
          saveCachedProfile(fallbackUser);
        }
      } else if (!data) {
        console.warn('Perfil não encontrado em public.profiles. Criando perfil padrão...');
        const fallbackUser: UserProfile = {
          id: userId,
          full_name: sessionRef.current?.user?.user_metadata?.full_name || sessionRef.current?.user?.email?.split('@')[0] || 'Usuário',
          role: 'Administrador',
        };
        setProfile(fallbackUser);
        saveCachedProfile(fallbackUser);

        // Tenta salvar o profile no banco em background
        try {
          await supabase.from('profiles').insert([
            { id: userId, full_name: fallbackUser.full_name, role: fallbackUser.role }
          ]);
        } catch {}
      } else {
        const userProf: UserProfile = {
          id: data.id,
          full_name: data.full_name,
          role: data.role,
        };
        setProfile((prev) => {
          if (prev?.id === userProf.id && prev?.full_name === userProf.full_name && prev?.role === userProf.role) {
            return prev;
          }
          return userProf;
        });
        saveCachedProfile(userProf);
      }
    } catch (err: any) {
      console.warn('Exceção capturada na consulta public.profiles (modo offline/resiliente):', err?.message || err);
      const cached = loadCachedProfile();
      if (cached && cached.id === userId) {
        setProfile(cached);
      } else if (!profileRef.current) {
        const fallbackUser: UserProfile = {
          id: userId,
          full_name: sessionRef.current?.user?.user_metadata?.full_name || sessionRef.current?.user?.email?.split('@')[0] || 'Usuário',
          role: 'Administrador',
        };
        setProfile(fallbackUser);
        saveCachedProfile(fallbackUser);
      }
    } finally {
      setProfileLoading(false);
    }
  }, []);

  // Initialize and persist session
  useEffect(() => {
    let mounted = true;

    async function checkSession() {
      try {
        const { data: { session: initialSession }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Error fetching session:', error.message);
        }
        if (mounted) {
          setSession(initialSession);
          if (initialSession?.user?.id) {
            await fetchProfile(initialSession.user.id, true);
          } else {
            // Se realmente não há sessão, redirecionar para login
            if (!hasCachedSession) {
              setProfile(null);
            }
          }
          setLoading(false);
        }
      } catch (err) {
        console.error('Session verification error:', err);
        if (mounted) {
          setLoading(false);
        }
      }
    }

    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, currentSession) => {
      if (mounted) {
        setSession(currentSession);
        if (currentSession?.user?.id) {
          await fetchProfile(currentSession.user.id, true);
        } else {
          setProfile(null);
          clearCachedProfile();
          setProfileQueryError(null);
          setProfileNotFound(false);
          setProfileLoading(false);
        }
        setLoading(false);
      }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [fetchProfile, hasCachedSession]);

  // Route protection and redirection to /app/leads
  useEffect(() => {
    if (loading) return;

    if (!session && !profile) {
      if (path !== '/login') {
        navigate('/login');
      }
    } else {
      if (path === '/login' || path === '/' || path === '/app') {
        navigate('/app/leads');
      }
    }
  }, [session, profile, loading, path]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Por favor, informe e-mail e senha.');
      return;
    }

    setLoginLoading(true);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) {
        if (error.message.includes('Invalid login credentials')) {
          setErrorMessage('Credenciais inválidas. Verifique seu e-mail e senha.');
        } else if (error.message.includes('Email not confirmed')) {
          setErrorMessage('E-mail ainda não confirmado no Supabase.');
        } else {
          setErrorMessage(error.message || 'Erro ao realizar login.');
        }
      } else if (data.session) {
        setSession(data.session);
        if (data.session.user.id) {
          await fetchProfile(data.session.user.id);
        }
        navigate('/app/leads');
      }
    } catch (err) {
      setErrorMessage('Falha na comunicação com o servidor de autenticação.');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    try {
      clearCRMCache();
      clearCachedProfile();
      await supabase.auth.signOut();
      setSession(null);
      setProfile(null);
      setProfileQueryError(null);
      setProfileNotFound(false);
      navigate('/login');
    } catch (err) {
      console.error('Logout error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Exibir loading inicial APENAS se não houver dados em cache nem profile
  if (loading && !profile) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm">
          Carregando pipeline...
        </p>
      </div>
    );
  }

  // Área de Login (/login) - Clean, premium, minimalist authentication
  if (!session && !profile) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 selection:bg-indigo-500 selection:text-white">
        <div className="w-full max-w-sm bg-slate-900/90 border border-slate-800 rounded-2xl p-7 shadow-2xl backdrop-blur-xl">
          {/* Subtle Key/Shield Icon */}
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/70 flex items-center justify-center mx-auto mb-6 text-indigo-400 shadow-inner">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          {!isSupabaseConfigured && (
            <div className="mb-5 p-3 bg-amber-950/60 border border-amber-600/40 rounded-xl text-amber-200 text-xs">
              <strong>Atenção:</strong> Configurações do Supabase não detectadas no ambiente.
            </div>
          )}

          {errorMessage && (
            <div className="mb-5 p-3.5 bg-rose-950/70 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-start gap-2">
              <span className="font-semibold shrink-0">Erro:</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@empresa.com"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Senha
              </label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-indigo-900/60 disabled:text-indigo-400 text-white font-medium rounded-xl transition-colors text-sm shadow-md cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loginLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Autenticando...</span>
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Active profile fallback - if session exists, never block the user
  const activeProfile: UserProfile | null = profile || (session?.user ? {
    id: session.user.id,
    full_name: session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || 'Usuário',
    role: 'Administrador',
  } : null);

  // Se não houver profile nem sessão ativa, exibir tela de Login
  if (!activeProfile) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 selection:bg-indigo-500 selection:text-white">
        <div className="w-full max-w-sm bg-slate-900/90 border border-slate-800 rounded-2xl p-7 shadow-2xl backdrop-blur-xl">
          <div className="w-10 h-10 rounded-xl bg-slate-800 border border-slate-700/70 flex items-center justify-center mx-auto mb-6 text-indigo-400 shadow-inner">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>

          <h2 className="text-base font-bold text-center text-white mb-1">Acesso ao CRM</h2>
          <p className="text-xs text-slate-400 text-center mb-6">Entre com suas credenciais para continuar</p>

          {errorMessage && (
            <div className="mb-5 p-3.5 bg-rose-950/70 border border-rose-500/50 rounded-xl text-rose-200 text-xs flex items-start gap-2">
              <span className="font-semibold shrink-0">Erro:</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                E-mail
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@empresa.com"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Senha
              </label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full mt-2 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-indigo-900/60 disabled:text-indigo-400 text-white font-medium rounded-xl transition-colors text-sm shadow-md cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loginLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Autenticando...</span>
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Determine active route
  const isFollowUpsActive = path.startsWith('/app/followups');

  return (
    <CRMProvider currentProfile={activeProfile}>
      <div className="min-h-screen bg-[#09090b] text-zinc-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white">
        {/* Top Global Navigation Bar - Full Width & Harmonious */}
        <header className="sticky top-0 z-40 w-full bg-[#09090b]/95 border-b border-zinc-800/80 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4">
          {/* Module Selector */}
          <div className="flex items-center gap-3 sm:gap-5">
            {/* Horizontal Module Selector Tab Group */}
            <div className="flex items-center bg-zinc-900/90 border border-zinc-800 rounded-xl p-1 shadow-inner">
              <button
                type="button"
                onClick={() => navigate('/app/leads')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  !isFollowUpsActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <span>Pipeline</span>
              </button>
              <button
                type="button"
                onClick={() => navigate('/app/followups')}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                  isFollowUpsActive
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'text-zinc-400 hover:text-white hover:bg-zinc-800/50'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Follow-ups</span>
              </button>
            </div>
          </div>

          {/* User Profile & Logout */}
          <div className="flex items-center gap-3 shrink-0">

            <div className="flex items-center gap-2">
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-zinc-900 border border-zinc-700/80 flex items-center justify-center text-xs font-bold text-indigo-300">
                {(activeProfile.full_name || 'U').charAt(0).toUpperCase()}
              </div>
              <div className="text-left hidden md:block leading-tight">
                <span className="text-xs font-semibold text-white block truncate max-w-[130px]">
                  {activeProfile.full_name || 'Usuário'}
                </span>
                <span className="text-[10px] text-zinc-400 block truncate max-w-[130px]">
                  {session?.user?.email || 'Conectado'}
                </span>
              </div>
            </div>

            <button
              onClick={handleLogout}
              title="Sair do sistema"
              className="py-1.5 px-2.5 bg-zinc-900 hover:bg-rose-950/60 hover:text-rose-300 text-zinc-400 border border-zinc-800 hover:border-rose-800/50 rounded-xl text-xs font-medium transition-all cursor-pointer flex items-center gap-1.5 shadow-xs"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
              <span className="hidden sm:inline">Sair</span>
            </button>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 min-w-0 bg-slate-950 flex flex-col">
          {isFollowUpsActive ? (
            <FollowUpsModule
              currentProfile={activeProfile}
              onOpenLead={(leadId) => {
                setTargetLeadIdForView(leadId);
                navigate('/app/leads');
              }}
            />
          ) : (
            <LeadsModule
              currentProfile={activeProfile}
              initialSelectedLeadId={targetLeadIdForView}
              onClearInitialLead={() => setTargetLeadIdForView(null)}
            />
          )}
        </main>
      </div>
    </CRMProvider>
  );
}
