import React, { useEffect, useState, useCallback } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import LeadsModule from './components/LeadsModule.tsx';
import ContactsModule from './components/ContactsModule.tsx';
import FollowUpsModule from './components/FollowUpsModule.tsx';

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: string | null;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [path, setPath] = useState<string>(() => window.location.pathname);

  // Central state for profile
  const [profile, setProfile] = useState<UserProfile | null>(null);
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

  // Fetch profile from public.profiles with diagnostic logging
  const fetchProfile = useCallback(async (userId: string) => {
    setProfileLoading(true);
    setProfileQueryError(null);
    setProfileNotFound(false);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Erro completo na consulta public.profiles:', error);
        setProfile(null);
        setProfileQueryError({
          message: error.message || 'Sem mensagem de erro',
          code: error.code || 'N/A',
          details: error.details || 'N/A',
          hint: error.hint || 'N/A',
        });
        setProfileNotFound(false);
      } else if (!data) {
        console.warn('Consulta a public.profiles retornou data = null sem erro.');
        setProfile(null);
        setProfileQueryError(null);
        setProfileNotFound(true);
      } else {
        setProfile({
          id: data.id,
          full_name: data.full_name,
          role: data.role,
        });
        setProfileQueryError(null);
        setProfileNotFound(false);
      }
    } catch (err: any) {
      console.error('Exceção capturada na consulta public.profiles:', err);
      setProfile(null);
      setProfileQueryError({
        message: err?.message || String(err),
        code: err?.code || 'EXCEPTION',
        details: err?.details || String(err?.stack || 'N/A'),
        hint: err?.hint || 'N/A',
      });
      setProfileNotFound(false);
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
            await fetchProfile(initialSession.user.id);
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
          await fetchProfile(currentSession.user.id);
        } else {
          setProfile(null);
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
  }, [fetchProfile]);

  // Route protection and redirection to /app/leads
  useEffect(() => {
    if (loading || profileLoading) return;

    if (!session) {
      if (path !== '/login') {
        navigate('/login');
      }
    } else {
      if (path === '/login' || path === '/' || path === '/app') {
        navigate('/app/leads');
      }
    }
  }, [session, loading, profileLoading, path]);

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

  // Exibir loading durante a verificação da sessão ou carregamento do perfil
  if (loading || (session && profileLoading)) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-6">
        <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-slate-400 text-sm">
          {session ? 'Carregando perfil e permissões...' : 'Verificando sessão...'}
        </p>
      </div>
    );
  }

  // Área de Login (/login) - Clean, premium, minimalist authentication
  if (!session) {
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

  // 1. Se query error existir: exibir temporariamente os detalhes técnicos do erro
  if (profileQueryError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-slate-900 border border-red-500/50 rounded-2xl p-8 shadow-2xl text-left">
          <div className="w-12 h-12 rounded-xl bg-red-950/80 border border-red-700/60 flex items-center justify-center mb-4 text-red-400 font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Diagnóstico: Erro na consulta ao profile</h1>
          <p className="text-slate-400 text-xs mb-4">
            Detalhes retornados pelo Supabase para identificação do problema:
          </p>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-2 text-xs font-mono mb-6">
            <div>
              <span className="text-red-400 font-semibold block">error.message:</span>
              <span className="text-slate-200 break-all">{profileQueryError.message}</span>
            </div>
            <div>
              <span className="text-amber-400 font-semibold block">error.code:</span>
              <span className="text-slate-200">{profileQueryError.code}</span>
            </div>
            <div>
              <span className="text-blue-400 font-semibold block">error.details:</span>
              <span className="text-slate-200 break-all">{profileQueryError.details}</span>
            </div>
            <div>
              <span className="text-emerald-400 font-semibold block">error.hint:</span>
              <span className="text-slate-200 break-all">{profileQueryError.hint}</span>
            </div>
            <div className="pt-2 border-t border-slate-800/80">
              <span className="text-slate-500 block">user.id consultado:</span>
              <span className="text-slate-300">{session.user.id}</span>
            </div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => fetchProfile(session.user.id)}
              className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition-colors text-xs cursor-pointer text-center"
            >
              Tentar novamente
            </button>
            <button
              onClick={handleLogout}
              className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-xl transition-colors text-xs cursor-pointer"
            >
              Encerrar sessão
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 2. Somente se NÃO houver erro e data for null
  if (profileNotFound || !profile) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl text-center">
          <div className="w-12 h-12 rounded-xl bg-amber-950/80 border border-amber-700/60 flex items-center justify-center mx-auto mb-4 text-amber-400 font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Acesso Bloqueado</h1>
          <p className="text-amber-300 text-xs mb-6">
            Perfil de usuário não encontrado.
          </p>
          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-400 mb-6 font-mono text-left space-y-1">
            <div><span className="text-slate-500">E-mail:</span> {session.user.email}</div>
            <div><span className="text-slate-500">ID:</span> {session.user.id}</div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => fetchProfile(session.user.id)}
              className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-xl transition-colors text-xs cursor-pointer"
            >
              Tentar novamente
            </button>
            <button
              onClick={handleLogout}
              className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-xl transition-colors text-xs cursor-pointer"
            >
              Encerrar sessão
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Determine active route
  const isFollowUpsActive = path.startsWith('/app/followups');
  const isContactsActive = path.startsWith('/app/contatos');
  const isLeadsActive =
    path.startsWith('/app/leads') ||
    path === '/app' ||
    (!isContactsActive && !isFollowUpsActive && path.startsWith('/app'));

  const navItems = [
    {
      id: 'leads',
      label: 'Leads',
      path: '/app/leads',
      active: isLeadsActive,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
    },
    {
      id: 'contatos',
      label: 'Contatos',
      path: '/app/contatos',
      active: isContactsActive,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      ),
    },
    {
      id: 'followups',
      label: 'Follow-ups',
      path: '/app/followups',
      active: isFollowUpsActive,
      icon: (
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col md:flex-row antialiased selection:bg-indigo-500 selection:text-white">
      {/* Mobile Top Header */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 bg-slate-900/90 border-b border-slate-800/80 sticky top-0 z-30 backdrop-blur-md">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            aria-label="Abrir menu lateral"
            className="p-2 rounded-xl bg-slate-800/70 border border-slate-700/60 text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="font-bold text-sm tracking-tight text-white">
            {isFollowUpsActive ? 'Follow-ups' : isContactsActive ? 'Contatos' : 'Leads'}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-indigo-600 border border-indigo-400/40 flex items-center justify-center text-xs text-white font-semibold">
            {(profile.full_name || 'U').charAt(0).toUpperCase()}
          </div>
        </div>
      </div>

      {/* Mobile Slide-Over Drawer Overlay */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
          />
          <div className="fixed inset-y-0 left-0 w-72 max-w-full bg-slate-900 border-r border-slate-800 flex flex-col justify-between p-5 shadow-2xl z-10 animate-in slide-in-from-left duration-200">
            <div>
              <div className="flex items-center justify-between pb-5 border-b border-slate-800/80 mb-6">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                    T
                  </div>
                  <div>
                    <h2 className="font-bold text-sm text-white leading-none">Controle Interno</h2>
                    <span className="text-[10px] text-slate-400">CRM Comercial</span>
                  </div>
                </div>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <nav className="space-y-1.5">
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.path)}
                    className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                      item.active
                        ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 font-semibold shadow-xs'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                    }`}
                  >
                    <span className={item.active ? 'text-indigo-400' : 'text-slate-500'}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </button>
                ))}
              </nav>
            </div>

            <div className="pt-4 border-t border-slate-800/80">
              <div className="flex items-center gap-3 mb-4 px-2">
                <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-sm font-semibold text-white">
                  {(profile.full_name || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-white truncate">{profile.full_name || 'Sem nome'}</div>
                  <div className="text-[11px] text-slate-400 truncate">{session.user.email}</div>
                </div>
              </div>
              <button
                onClick={handleLogout}
                className="w-full py-2 px-3 bg-slate-800/60 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800/50 border border-slate-700/60 rounded-xl text-xs text-slate-300 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Encerrar sessão
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 shrink-0 bg-slate-900/80 border-r border-slate-800/80 flex-col justify-between p-5 min-h-screen sticky top-0 backdrop-blur-xl">
        <div>
          {/* Brand Header */}
          <div className="flex items-center gap-3 px-2 pb-6 border-b border-slate-800/60 mb-6">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
              T
            </div>
            <div>
              <h2 className="font-bold text-sm text-white tracking-tight">Controle Interno</h2>
              <span className="text-[11px] text-slate-400 font-medium">CRM Comercial</span>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => navigate(item.path)}
                className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all cursor-pointer ${
                  item.active
                    ? 'bg-indigo-600/15 text-indigo-300 border border-indigo-500/30 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
                }`}
              >
                <span className={item.active ? 'text-indigo-400' : 'text-slate-500'}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
        </div>

        {/* User profile & Logout */}
        <div className="pt-4 border-t border-slate-800/70">
          <div className="flex items-center gap-3 mb-3.5 px-2">
            <div className="w-9 h-9 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-xs font-semibold text-white shrink-0">
              {(profile.full_name || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-white truncate">{profile.full_name || 'Sem nome'}</div>
              <div className="text-[11px] text-slate-400 truncate">{session.user.email}</div>
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Sair do sistema"
            className="w-full py-2 px-3 bg-slate-950 hover:bg-rose-950/60 hover:text-rose-300 hover:border-rose-800/60 border border-slate-800/80 rounded-xl text-xs text-slate-400 font-medium transition-colors cursor-pointer flex items-center justify-center gap-2"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sair
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 bg-slate-950 flex flex-col">
        {isFollowUpsActive ? (
          <FollowUpsModule
            currentProfile={profile}
            onOpenLead={(leadId) => {
              setTargetLeadIdForView(leadId);
              navigate('/app/leads');
            }}
          />
        ) : isContactsActive ? (
          <ContactsModule currentProfile={profile} />
        ) : (
          <LeadsModule
            currentProfile={profile}
            initialSelectedLeadId={targetLeadIdForView}
            onClearInitialLead={() => setTargetLeadIdForView(null)}
          />
        )}
      </main>
    </div>
  );
}
