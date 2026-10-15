import React, { useEffect, useState, useCallback, useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from './lib/supabase.ts';
import { clearCRMCache } from './lib/crmCache.ts';
import { CRMProvider } from './lib/crmStore.tsx';
import { ThemeProvider } from './lib/themeContext.tsx';
import { CondoUIContextProvider } from './lib/condoUIContext.tsx';
import { PermissionsProvider, DEFAULT_USER_PERMISSIONS } from './lib/permissionsContext.tsx';
import LeadsModule from './components/LeadsModule.tsx';
import FollowUpsModule from './components/FollowUpsModule.tsx';
import UsersManagementModule from './components/UsersManagementModule.tsx';
import { CondoFloatingButton } from './components/CondoAssistant/CondoFloatingButton.tsx';
import { CondoDrawer } from './components/CondoAssistant/CondoDrawer.tsx';
import { formatProperName } from './lib/contactAdapter.ts';

const TRIVERUS_LOGO_URL = 'https://adm.triveruscondo.com/wp-content/uploads/2026/10/7.png';

export interface UserProfile {
  id: string;
  full_name: string | null;
  role: string | null;
  email?: string | null;
  is_active?: boolean;
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

  // Condo AI Assistant Drawer state
  const [condoOpen, setCondoOpen] = useState<boolean>(false);

  // State for mobile drawer & unified user hub dropdown
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userHubOpen, setUserHubOpen] = useState(false);

  // First-access / password setup modal for invited or recovery users
  const [passwordSetupOpen, setPasswordSetupOpen] = useState<boolean>(() => {
    const hash = window.location.hash || '';
    const search = window.location.search || '';
    return (
      hash.includes('type=invite') ||
      hash.includes('type=recovery') ||
      search.includes('type=invite') ||
      search.includes('type=recovery')
    );
  });
  const [newUserPassword, setNewUserPassword] = useState('');
  const [confirmUserPassword, setConfirmUserPassword] = useState('');
  const [passwordSetupSaving, setPasswordSetupSaving] = useState(false);
  const [passwordSetupError, setPasswordSetupError] = useState<string | null>(null);
  const [passwordSetupSuccess, setPasswordSetupSuccess] = useState<string | null>(null);

  // Synchronize route navigation
  const navigate = (newPath: string) => {
    if (window.location.pathname !== newPath) {
      window.history.pushState({}, '', newPath);
    }
    setPath(newPath);
    setMobileMenuOpen(false);
    setUserHubOpen(false);
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
        .select('id, full_name, role, email, is_active')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.warn('Aviso de rede na consulta a public.profiles:', error.message);
        // Fallback resiliente: nunca trava a tela com erro fatal em falha de conexão/offline
        const cached = loadCachedProfile();
        if (cached && cached.id === userId) {
          setProfile(cached);
        } else if (!profileRef.current) {
          const rawName = sessionRef.current?.user?.user_metadata?.full_name || sessionRef.current?.user?.email?.split('@')[0] || 'Usuário';
          const fallbackUser: UserProfile = {
            id: userId,
            full_name: formatProperName(rawName),
            role: 'user',
            email: sessionRef.current?.user?.email || null,
            is_active: true,
          };
          setProfile(fallbackUser);
          saveCachedProfile(fallbackUser);
        }
      } else if (!data) {
        console.warn('Perfil não encontrado em public.profiles. Criando perfil padrão com permissões...');
        const rawName = sessionRef.current?.user?.user_metadata?.full_name || sessionRef.current?.user?.email?.split('@')[0] || 'Usuário';
        const userEmail = sessionRef.current?.user?.email || null;
        const fallbackUser: UserProfile = {
          id: userId,
          full_name: formatProperName(rawName),
          role: 'user',
          email: userEmail,
          is_active: true,
        };
        setProfile(fallbackUser);
        saveCachedProfile(fallbackUser);

        // Salva o profile (role = 'user', is_active = true) e garante user_permissions em background
        try {
          await supabase.from('profiles').insert([
            {
              id: userId,
              full_name: fallbackUser.full_name,
              role: 'user',
              email: userEmail,
              is_active: true,
            }
          ]);
          await supabase.from('user_permissions').upsert([
            {
              user_id: userId,
              ...DEFAULT_USER_PERMISSIONS,
            }
          ], { onConflict: 'user_id' });
        } catch {}
      } else {
        const userProf: UserProfile = {
          id: data.id,
          full_name: formatProperName(data.full_name),
          role: data.role,
          email: data.email || sessionRef.current?.user?.email || null,
          is_active: data.is_active !== undefined ? Boolean(data.is_active) : true,
        };
        setProfile((prev) => {
          if (
            prev?.id === userProf.id &&
            prev?.full_name === userProf.full_name &&
            prev?.role === userProf.role &&
            prev?.email === userProf.email &&
            prev?.is_active === userProf.is_active
          ) {
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
          role: 'user',
          email: sessionRef.current?.user?.email || null,
          is_active: true,
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, currentSession) => {
      if (mounted) {
        if (event === 'PASSWORD_RECOVERY') {
          setPasswordSetupOpen(true);
        }
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

  const handleSaveUserPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordSetupError(null);
    setPasswordSetupSuccess(null);

    if (!newUserPassword || newUserPassword.length < 6) {
      setPasswordSetupError('A senha deve ter pelo menos 6 caracteres.');
      return;
    }
    if (newUserPassword !== confirmUserPassword) {
      setPasswordSetupError('A confirmação de senha não confere.');
      return;
    }

    setPasswordSetupSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newUserPassword,
      });
      if (error) {
        setPasswordSetupError(error.message || 'Erro ao definir senha.');
        return;
      }
      setPasswordSetupSuccess('Senha definida com sucesso!');
      setNewUserPassword('');
      setConfirmUserPassword('');
      if (window.location.hash && (window.location.hash.includes('type=invite') || window.location.hash.includes('type=recovery'))) {
        window.history.replaceState({}, '', window.location.pathname);
      }
      setTimeout(() => {
        setPasswordSetupOpen(false);
        setPasswordSetupSuccess(null);
      }, 900);
    } catch (err: any) {
      setPasswordSetupError(err?.message || 'Erro inesperado ao atualizar senha.');
    } finally {
      setPasswordSetupSaving(false);
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
    role: 'user',
    email: session.user.email || null,
    is_active: true,
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

  // Bloqueio visual e operacional caso a conta do usuário esteja inativa (is_active === false)
  if (activeProfile.is_active === false) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-slate-900/95 border border-rose-500/40 rounded-2xl p-7 shadow-2xl text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-rose-950/70 border border-rose-500/40 text-rose-400 flex items-center justify-center mx-auto">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h2 className="text-lg font-bold text-white">Acesso Desativado</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            Sua conta (<span className="text-slate-200 font-medium">{activeProfile.email || activeProfile.full_name}</span>) encontra-se inativa no Triverus CRM. Entre em contato com o Administrador para reativar seu acesso.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full py-2.5 px-4 bg-slate-800 hover:bg-rose-600 text-white font-semibold rounded-xl text-xs transition-colors cursor-pointer"
          >
            Sair da conta
          </button>
        </div>
      </div>
    );
  }

  const normalizedRole = (activeProfile.role || '').trim().toLowerCase();
  const isAdminUser = normalizedRole === 'admin' || normalizedRole === 'administrador';

  // Determine active route
  const isFollowUpsActive = path.startsWith('/app/followups');
  const isUsersSettingsActive = isAdminUser && (path.startsWith('/app/settings/users') || path.startsWith('/app/users'));

  return (
    <ThemeProvider>
      <CondoUIContextProvider>
        <PermissionsProvider currentProfile={activeProfile}>
          <CRMProvider currentProfile={activeProfile}>
            <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-indigo-500 selection:text-white transition-colors duration-150">
              {/* Top Global Navigation Bar - Full Width & Harmonious */}
              <header className="sticky top-0 z-40 w-full bg-slate-900/95 border-b border-slate-800 backdrop-blur-md px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-between gap-4 shadow-2xs">
                {/* Module Selector */}
                <div className="flex items-center gap-3 sm:gap-5">
                  {/* Horizontal Module Selector Tab Group */}
                  <div className="flex items-center bg-slate-800/70 border border-slate-700/60 rounded-xl p-1">
                    <button
                      type="button"
                      data-help-id="pipeline-menu"
                      onClick={() => navigate('/app/leads')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                        !isFollowUpsActive && !isUsersSettingsActive
                          ? 'bg-[#FF6600] text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40'
                      }`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <span>Pipeline</span>
                    </button>
                    <button
                      type="button"
                      data-help-id="followups-menu"
                      onClick={() => navigate('/app/followups')}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-2 cursor-pointer ${
                        isFollowUpsActive
                          ? 'bg-[#FF6600] text-white shadow-xs'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-slate-700/40'
                      }`}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span>Follow-ups</span>
                    </button>
                  </div>
                </div>

                {/* Gatilho único do Hub no canto superior direito: Logo da Triverus */}
                <div className="relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setUserHubOpen((prev) => !prev)}
                    title="Menu da conta e administração"
                    aria-label="Abrir menu da conta"
                    className={`h-9 px-2.5 rounded-xl border transition-all cursor-pointer flex items-center gap-1.5 shadow-2xs ${
                      userHubOpen || isUsersSettingsActive
                        ? 'bg-slate-800 border-[#FF6600] ring-1 ring-[#FF6600]/30'
                        : 'bg-slate-900/90 hover:bg-slate-800/80 border-slate-700/70 hover:border-slate-600'
                    }`}
                  >
                    <img
                      src={TRIVERUS_LOGO_URL}
                      alt="Triverus"
                      className="h-5 w-auto max-w-[85px] object-contain"
                    />
                    <svg
                      className={`w-3 h-3 text-slate-400 transition-transform ${userHubOpen ? 'rotate-180 text-white' : ''}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {userHubOpen && (
                    <>
                      <div
                        className="fixed inset-0 z-40"
                        onClick={() => setUserHubOpen(false)}
                      />
                      <div className="absolute right-0 mt-2 w-64 bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl py-2 px-2 z-50 animate-in fade-in zoom-in-95 duration-100">
                        {/* Identidade do Usuário (Nome, E-mail, Badge da função - SEM avatar/foto) */}
                        <div className="px-3 py-2.5 mb-2 bg-slate-950/70 rounded-xl border border-slate-800/80">
                          <p className="text-xs font-bold text-white truncate">
                            {activeProfile.full_name || 'Usuário'}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate mt-0.5">
                            {session?.user?.email || activeProfile.email || ''}
                          </p>
                          <div className="mt-2">
                            <span className={`inline-block px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
                              isAdminUser
                                ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30'
                                : 'bg-slate-800 text-slate-400 border border-slate-700'
                            }`}>
                              {isAdminUser ? 'ADMIN' : 'USUÁRIO'}
                            </span>
                          </div>
                        </div>

                        {/* Seção ADMINISTRAÇÃO (Apenas para Administrador - sem repetição de ADMIN) */}
                        {isAdminUser && (
                          <div className="mb-2">
                            <div className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                              Administração
                            </div>

                            <button
                              type="button"
                              onClick={() => {
                                setUserHubOpen(false);
                                navigate('/app/settings/users');
                              }}
                              className={`w-full px-2.5 py-2 text-left text-xs font-semibold rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer ${
                                isUsersSettingsActive
                                  ? 'bg-orange-500/15 text-[#FF6600]'
                                  : 'text-slate-200 hover:bg-slate-800 hover:text-white'
                              }`}
                            >
                              <svg className="w-4 h-4 text-[#FF6600] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                              </svg>
                              <div className="flex-1 min-w-0">
                                <span className="block text-xs font-semibold text-slate-100">Usuários e acessos</span>
                                <p className="text-[10px] font-normal text-slate-400 truncate">Equipe, status e permissões</p>
                              </div>
                            </button>

                            <div className="h-px bg-slate-800 my-1.5" />
                          </div>
                        )}

                        {/* Seção MINHA CONTA */}
                        <div>
                          <div className="px-2 pt-1 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                            Minha conta
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              setUserHubOpen(false);
                              setPasswordSetupError(null);
                              setPasswordSetupSuccess(null);
                              setNewUserPassword('');
                              setConfirmUserPassword('');
                              setPasswordSetupOpen(true);
                            }}
                            className="w-full px-2.5 py-2 text-left text-xs font-medium text-slate-200 hover:bg-slate-800 hover:text-white rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
                          >
                            <svg className="w-4 h-4 text-indigo-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                            <span>Alterar senha</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setUserHubOpen(false);
                              handleLogout();
                            }}
                            className="w-full px-2.5 py-2 text-left text-xs font-medium text-rose-400 hover:bg-rose-500/10 hover:text-rose-300 rounded-xl flex items-center gap-2.5 transition-colors cursor-pointer"
                          >
                            <svg className="w-4 h-4 text-rose-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            <span>Sair</span>
                          </button>
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </header>

              {/* Modal de Definição de Senha Própria (Primeiro Acesso por Convite / Redefinição) */}
              {passwordSetupOpen && (
                <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-150">
                  <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
                    <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-white">Definir sua Senha de Acesso</h3>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Escolha uma senha pessoal para acessar o Triverus CRM.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setPasswordSetupOpen(false)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>

                    <form onSubmit={handleSaveUserPassword} className="p-6 space-y-4">
                      {passwordSetupError && (
                        <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs">
                          {passwordSetupError}
                        </div>
                      )}
                      {passwordSetupSuccess && (
                        <div className="p-3 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-emerald-200 text-xs font-semibold">
                          ✓ {passwordSetupSuccess}
                        </div>
                      )}

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Nova Senha (mínimo 6 caracteres)
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={newUserPassword}
                          onChange={(e) => setNewUserPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-[#FF6600]"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                          Confirmar Nova Senha
                        </label>
                        <input
                          type="password"
                          required
                          minLength={6}
                          value={confirmUserPassword}
                          onChange={(e) => setConfirmUserPassword(e.target.value)}
                          placeholder="••••••••"
                          className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-[#FF6600]"
                        />
                      </div>

                      <div className="pt-2 flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setPasswordSetupOpen(false)}
                          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
                        >
                          Agora não
                        </button>
                        <button
                          type="submit"
                          disabled={passwordSetupSaving}
                          className="px-4 py-2 bg-[#FF6600] hover:bg-[#e65c00] disabled:opacity-50 text-white rounded-xl text-xs font-semibold cursor-pointer"
                        >
                          {passwordSetupSaving ? 'Salvando...' : 'Salvar Senha'}
                        </button>
                      </div>
                    </form>
                  </div>
                </div>
              )}

              {/* Main Content Area */}
              <main className="flex-1 min-w-0 bg-slate-950 flex flex-col">
                {isUsersSettingsActive ? (
                  <UsersManagementModule
                    currentProfile={activeProfile}
                    onBackToPipeline={() => navigate('/app/leads')}
                  />
                ) : isFollowUpsActive ? (
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

              {/* Condo AI Assistant Floating Bubble & Drawer */}
              <CondoFloatingButton
                isOpen={condoOpen}
                onClick={() => setCondoOpen((prev) => !prev)}
              />
              <CondoDrawer
                isOpen={condoOpen}
                onClose={() => setCondoOpen(false)}
                currentProfile={activeProfile}
                onOpenLead={(leadId) => {
                  setTargetLeadIdForView(leadId);
                  navigate('/app/leads');
                }}
                onOpenFollowUp={(leadId) => {
                  if (leadId) setTargetLeadIdForView(leadId);
                  navigate('/app/followups');
                }}
                currentPath={path}
                navigate={navigate}
              />
            </div>
          </CRMProvider>
        </PermissionsProvider>
      </CondoUIContextProvider>
    </ThemeProvider>
  );
}
