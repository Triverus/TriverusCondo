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

  // Synchronize route navigation
  const navigate = (newPath: string) => {
    if (window.location.pathname !== newPath) {
      window.history.pushState({}, '', newPath);
    }
    setPath(newPath);
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

  // Área de Login (/login)
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-extrabold text-white tracking-tight">Triverus</h1>
            <p className="text-slate-400 text-sm mt-1">CRM e Gestão de Oportunidades</p>
          </div>

          {!isSupabaseConfigured && (
            <div className="mb-6 p-3 bg-amber-950/60 border border-amber-600/40 rounded-lg text-amber-200 text-xs">
              <strong>Atenção:</strong> VITE_SUPABASE_URL ou VITE_SUPABASE_PUBLISHABLE_KEY não foram detectadas no ambiente local.
            </div>
          )}

          {errorMessage && (
            <div className="mb-6 p-3.5 bg-red-950/70 border border-red-500/50 rounded-lg text-red-200 text-sm flex items-start gap-2">
              <span className="font-semibold">Erro:</span>
              <span>{errorMessage}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                E-mail
              </label>
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@triverus.com"
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                Senha
              </label>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-colors text-sm"
              />
            </div>

            <button
              type="submit"
              disabled={loginLoading}
              className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-900 disabled:text-indigo-400 text-white font-medium rounded-lg transition-colors text-sm shadow-md cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loginLoading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Entrando...</span>
                </>
              ) : (
                'Entrar'
              )}
            </button>
          </form>

          {/* Não permitir cadastro público */}
          <div className="mt-8 pt-6 border-t border-slate-800/80 text-center">
            <p className="text-xs text-slate-500">
              Cadastros públicos estão desabilitados.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // 1. Se query error existir: exibir temporariamente os detalhes técnicos do erro
  if (profileQueryError) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-slate-900 border border-red-500/50 rounded-xl p-8 shadow-2xl text-left">
          <div className="w-12 h-12 rounded-full bg-red-950/80 border border-red-700/60 flex items-center justify-center mb-4 text-red-400 font-bold text-xl">
            !
          </div>
          <h1 className="text-xl font-bold text-white mb-2">Diagnóstico: Erro na consulta ao profile</h1>
          <p className="text-slate-400 text-xs mb-4">
            Detalhes retornados pelo Supabase para identificação do problema:
          </p>

          <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2.5 text-xs font-mono mb-6">
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
              className="flex-1 py-2 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors text-xs cursor-pointer text-center"
            >
              Tentar novamente
            </button>
            <button
              onClick={handleLogout}
              className="py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium rounded-lg transition-colors text-xs cursor-pointer"
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
        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl text-center">
          <div className="w-12 h-12 rounded-full bg-amber-950/80 border border-amber-700/60 flex items-center justify-center mx-auto mb-4 text-amber-400 font-bold text-xl">
            !
          </div>
          <h1 className="text-2xl font-bold text-white mb-2">Acesso Bloqueado</h1>
          <p className="text-amber-300 text-sm mb-6">
            Perfil de usuário não encontrado.
          </p>
          <div className="bg-slate-800/60 border border-slate-700/60 rounded-lg p-3 text-xs text-slate-400 mb-6 font-mono text-left space-y-1">
            <div><span className="text-slate-500">E-mail:</span> {session.user.email}</div>
            <div><span className="text-slate-500">ID:</span> {session.user.id}</div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => fetchProfile(session.user.id)}
              className="flex-1 py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white font-medium rounded-lg transition-colors text-sm cursor-pointer"
            >
              Tentar novamente
            </button>
            <button
              onClick={handleLogout}
              className="py-2.5 px-4 bg-slate-800 hover:bg-slate-700 text-white font-medium rounded-lg transition-colors text-sm cursor-pointer"
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

  // Área interna autenticada (/app/leads, /app/contatos e /app/followups)
  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/90 backdrop-blur sticky top-0 z-40 px-3 sm:px-6 py-2.5 sm:py-3.5 flex items-center justify-between gap-2 sm:gap-4">
        <div className="flex items-center gap-3 sm:gap-6">
          <div className="flex items-center gap-2">
            <span className="text-lg sm:text-xl font-bold tracking-tight text-white">Triverus</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-950 border border-indigo-700/60 text-indigo-300 font-semibold uppercase">
              CRM
            </span>
          </div>

          <nav className="flex items-center gap-1 sm:gap-1.5">
            <button
              type="button"
              onClick={() => navigate('/app/leads')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                isLeadsActive
                  ? 'bg-slate-800 text-white border border-slate-700 font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              Leads
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/contatos')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                isContactsActive
                  ? 'bg-slate-800 text-white border border-slate-700 font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              Contatos
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/followups')}
              className={`px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer ${
                isFollowUpsActive
                  ? 'bg-slate-800 text-white border border-slate-700 font-semibold shadow-xs'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/50 border border-transparent'
              }`}
            >
              Follow-ups
            </button>
          </nav>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          <div className="text-right hidden sm:block">
            <div className="flex items-center justify-end gap-1.5">
              <span className="text-xs font-medium text-slate-200">
                {profile.full_name || 'Sem nome'}
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 border border-emerald-700/60 text-emerald-400 font-mono uppercase">
                {profile.role || 'user'}
              </span>
            </div>
            <div className="text-[11px] text-slate-400">
              {session.user.email}
            </div>
          </div>

          <button
            onClick={handleLogout}
            title="Sair do sistema"
            className="px-2.5 sm:px-3 py-1.5 text-xs font-medium bg-slate-800 hover:bg-red-950 hover:text-red-300 hover:border-red-800 border border-slate-700 rounded-lg text-slate-300 transition-colors cursor-pointer"
          >
            Sair
          </button>
        </div>
      </header>

      {/* Main content: Leads Module, Contacts Module or Follow-ups Module */}
      <main className="flex-1 pb-12">
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
