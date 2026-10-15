import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '../lib/supabase.ts';
import type { UserProfile } from '../App.tsx';
import ProfileAvatar from './ProfileAvatar.tsx';
import { useUserPermissions, type UserPermissions } from '../lib/permissionsContext.tsx';

interface AdminUserData {
  id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'user';
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  permissions: {
    can_manage_notes: boolean;
    can_delete_notes: boolean;
    can_manage_leads: boolean;
    can_delete_leads: boolean;
    can_change_stage: boolean;
    can_manage_contacts: boolean;
  };
}

interface UsersManagementModuleProps {
  currentProfile: UserProfile;
  onBackToPipeline: () => void;
}

export default function UsersManagementModule({
  currentProfile,
  onBackToPipeline,
}: UsersManagementModuleProps) {
  const { isAdmin } = useUserPermissions();

  const [users, setUsers] = useState<AdminUserData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [roleFilter, setRoleFilter] = useState<'all' | 'admin' | 'user'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Modal de edição de usuário
  const [editingUser, setEditingUser] = useState<AdminUserData | null>(null);
  const [editFullName, setEditFullName] = useState<string>('');
  const [editRole, setEditRole] = useState<'admin' | 'user'>('user');
  const [editIsActive, setEditIsActive] = useState<boolean>(true);
  const [editPerms, setEditPerms] = useState<{
    can_manage_notes: boolean;
    can_delete_notes: boolean;
    can_manage_leads: boolean;
    can_delete_leads: boolean;
    can_change_stage: boolean;
    can_manage_contacts: boolean;
  }>({
    can_manage_notes: true,
    can_delete_notes: false,
    can_manage_leads: true,
    can_delete_leads: false,
    can_change_stage: true,
    can_manage_contacts: true,
  });
  const [editSaving, setEditSaving] = useState<boolean>(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Modal de convite de novo usuário
  const [isInviteModalOpen, setIsInviteModalOpen] = useState<boolean>(false);
  const [inviteFullName, setInviteFullName] = useState<string>('');
  const [inviteEmail, setInviteEmail] = useState<string>('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'user'>('user');
  const [invitePerms, setInvitePerms] = useState<{
    can_manage_notes: boolean;
    can_delete_notes: boolean;
    can_manage_leads: boolean;
    can_delete_leads: boolean;
    can_change_stage: boolean;
    can_manage_contacts: boolean;
  }>({
    can_manage_notes: true,
    can_delete_notes: false,
    can_manage_leads: true,
    can_delete_leads: false,
    can_change_stage: true,
    can_manage_contacts: true,
  });
  const [inviteSaving, setInviteSaving] = useState<boolean>(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [createdInviteResult, setCreatedInviteResult] = useState<{
    email: string;
    inviteLink: string | null;
  } | null>(null);

  // Modal de recuperação / primeiro acesso
  const [resetModalUser, setResetModalUser] = useState<AdminUserData | null>(null);
  const [resetSaving, setResetSaving] = useState<boolean>(false);
  const [resetSuccessMsg, setResetSuccessMsg] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [generatedRecoveryLink, setGeneratedRecoveryLink] = useState<string | null>(null);

  // Feedback toast
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setFeedback({ type, message });
    setTimeout(() => {
      setFeedback((prev) => (prev?.message === message ? null : prev));
    }, 4500);
  }, []);

  // Obter token de autenticação atual
  const getAccessToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  }, []);

  // Carregar lista de usuários da API administrativa
  const fetchUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        throw new Error('Sessão expirada. Faça login novamente.');
      }

      const res = await fetch('/api/admin/users', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Erro ao carregar usuários (${res.status})`);
      }

      const data = await res.json();
      setUsers(data.users || []);
    } catch (err: any) {
      console.error('Erro ao buscar usuários:', err);
      setError(err?.message || 'Falha na comunicação com o servidor.');
    } finally {
      setLoading(false);
    }
  }, [getAccessToken]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const [confirmDeactivatePrompt, setConfirmDeactivatePrompt] = useState<boolean>(false);

  // Abertura do modal de gerenciamento
  const handleOpenEdit = (user: AdminUserData) => {
    setEditingUser(user);
    setEditFullName(user.full_name || '');
    setEditRole(user.role);
    setEditIsActive(user.is_active);
    setConfirmDeactivatePrompt(false);
    setEditPerms({
      can_manage_notes: user.permissions.can_manage_notes,
      can_delete_notes: user.permissions.can_delete_notes,
      can_manage_leads: user.permissions.can_manage_leads,
      can_delete_leads: user.permissions.can_delete_leads,
      can_change_stage: user.permissions.can_change_stage,
      can_manage_contacts: user.permissions.can_manage_contacts,
    });
    setEditError(null);
  };

  // Persistir chave de permissão imediatamente ao alternar (e atualizar cache/estado local)
  const handleTogglePermission = async (
    key: keyof AdminUserData['permissions'],
    checked: boolean
  ) => {
    const nextPerms = { ...editPerms, [key]: checked };
    setEditPerms(nextPerms);

    if (!editingUser) return;

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão inválida.');

      const res = await fetch(`/api/admin/users/${editingUser.id}/permissions`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(nextPerms),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Erro ao salvar permissão.');
      }

      // Atualizar estado local imediatamente
      setUsers((prev) =>
        prev.map((u) =>
          u.id === editingUser.id ? { ...u, permissions: nextPerms } : u
        )
      );
      setEditingUser((prev) =>
        prev ? { ...prev, permissions: nextPerms } : null
      );
      showToast('Permissão salva em public.user_permissions!');
    } catch (err: any) {
      setEditError(err?.message || 'Falha ao persistir permissão.');
    }
  };

  // Salvar alterações de usuário
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    setEditSaving(true);
    setEditError(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão inválida.');

      const payload: Record<string, any> = {
        id: editingUser.id,
        full_name: editFullName.trim(),
        role: editRole,
        is_active: editIsActive,
      };
      if (editRole === 'user') {
        payload.permissions = editPerms;
      }

      const res = await fetch('/api/admin/update-user', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Erro ao atualizar usuário.');
      }

      showToast(`Usuário "${editFullName.trim()}" salvo com sucesso!`);
      setEditingUser(null);
      setConfirmDeactivatePrompt(false);
      await fetchUsers();
    } catch (err: any) {
      setEditError(err?.message || 'Falha ao salvar alterações.');
    } finally {
      setEditSaving(false);
    }
  };

  // Enviar convite de novo usuário (sem senha definida pelo admin)
  const handleSaveInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteSaving(true);
    setInviteError(null);
    setCreatedInviteResult(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão inválida.');

      if (!inviteEmail.trim() || !inviteEmail.includes('@')) {
        throw new Error('Informe um e-mail válido.');
      }

      const res = await fetch('/api/admin/users/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          email: inviteEmail.trim().toLowerCase(),
          full_name: inviteFullName.trim() || inviteEmail.split('@')[0],
          role: inviteRole,
          is_active: true,
          permissions: invitePerms,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Erro ao convidar usuário.');
      }

      setCreatedInviteResult({
        email: inviteEmail.trim().toLowerCase(),
        inviteLink: body.inviteLink || null,
      });

      showToast(`Usuário "${inviteFullName || inviteEmail}" convidado com sucesso!`);
      await fetchUsers();
    } catch (err: any) {
      setInviteError(err?.message || 'Falha ao enviar convite.');
    } finally {
      setInviteSaving(false);
    }
  };

  // Gerar link de recuperação de acesso para o próprio usuário definir sua senha
  const handleGenerateRecoveryLink = async (user: AdminUserData) => {
    setResetModalUser(user);
    setResetSuccessMsg(null);
    setResetError(null);
    setGeneratedRecoveryLink(null);
  };

  const handleExecuteResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetModalUser) return;

    setResetSaving(true);
    setResetError(null);
    setResetSuccessMsg(null);

    try {
      const token = await getAccessToken();
      if (!token) throw new Error('Sessão inválida.');

      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          id: resetModalUser.id,
          email: resetModalUser.email,
        }),
      });

      const body = await res.json();
      if (!res.ok) {
        throw new Error(body.error || 'Falha ao executar operação.');
      }

      if (body.recoveryLink) {
        setGeneratedRecoveryLink(body.recoveryLink);
        setResetSuccessMsg('Link de recuperação gerado com sucesso! Envie-o ao usuário para que ele defina sua própria senha.');
      }
      showToast('Link de acesso gerado com sucesso!');
    } catch (err: any) {
      setResetError(err?.message || 'Erro ao gerar link de acesso.');
    } finally {
      setResetSaving(false);
    }
  };

  // Filtragem dos usuários na lista
  const filteredUsers = useMemo(() => {
    return users.filter((u) => {
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const matchesName = u.full_name?.toLowerCase().includes(q);
        const matchesEmail = u.email?.toLowerCase().includes(q);
        if (!matchesName && !matchesEmail) return false;
      }
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (statusFilter === 'active' && !u.is_active) return false;
      if (statusFilter === 'inactive' && u.is_active) return false;
      return true;
    });
  }, [users, searchTerm, roleFilter, statusFilter]);

  if (!isAdmin) {
    return (
      <div className="w-full max-w-4xl mx-auto px-4 py-12 text-center">
        <div className="w-16 h-16 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center mx-auto mb-4">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Acesso Restrito a Administradores</h2>
        <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
          Apenas usuários com perfil de Administrador possuem autorização para gerenciar a equipe e definir permissões no sistema.
        </p>
        <button
          type="button"
          onClick={onBackToPipeline}
          className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors shadow-md"
        >
          Voltar ao Pipeline
        </button>
      </div>
    );
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-7xl mx-auto space-y-6">
      {/* Toast Notification */}
      {feedback && (
        <div className="fixed top-16 right-4 sm:right-8 z-50 animate-in fade-in slide-in-from-top-3 duration-200">
          <div
            className={`px-4 py-3 rounded-2xl border shadow-xl flex items-center gap-3 text-xs font-semibold backdrop-blur-md ${
              feedback.type === 'success'
                ? 'bg-emerald-950/90 border-emerald-500/70 text-emerald-200 shadow-emerald-950/30'
                : 'bg-rose-950/90 border-rose-500/70 text-rose-200 shadow-rose-950/30'
            }`}
          >
            <span>{feedback.message}</span>
            <button
              type="button"
              onClick={() => setFeedback(null)}
              className="p-1 rounded hover:bg-white/10 opacity-70 hover:opacity-100"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Header com Breadcrumb e Ação Principal */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-800">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
            <button
              type="button"
              onClick={onBackToPipeline}
              className="hover:text-indigo-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Pipeline</span>
            </button>
            <span>/</span>
            <span className="text-slate-300">Configurações</span>
            <span>/</span>
            <span className="text-white font-semibold">Usuários</span>
          </div>

          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Usuários
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Gerencie o acesso da equipe, funções e as 6 permissões operacionais do CRM.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={fetchUsers}
            disabled={loading}
            title="Recarregar lista"
            className="p-2.5 bg-slate-900 border border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white rounded-xl text-xs font-medium transition-colors cursor-pointer disabled:opacity-50"
          >
            <svg
              className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>

          <button
            type="button"
            onClick={() => {
              setInviteFullName('');
              setInviteEmail('');
              setInviteRole('user');
              setCreatedInviteResult(null);
              setInviteError(null);
              setIsInviteModalOpen(true);
            }}
            className="px-4 py-2.5 bg-[#FF6600] hover:bg-[#e65c00] active:bg-[#cc5200] text-white rounded-xl text-xs sm:text-sm font-bold shadow-lg shadow-orange-500/10 transition-all cursor-pointer flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
            </svg>
            <span>Convidar usuário</span>
          </button>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900/60 border border-slate-800/80 p-3 rounded-2xl">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome ou e-mail..."
            className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
          />
          <svg className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtro de Função */}
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="all">Todas as funções</option>
            <option value="admin">Administrador</option>
            <option value="user">Usuário</option>
          </select>

          {/* Filtro de Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 text-slate-300 text-xs rounded-xl px-3 py-2 focus:outline-none focus:border-indigo-500 cursor-pointer"
          >
            <option value="all">Todos os status</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
          </select>
        </div>
      </div>

      {/* Lista de Usuários */}
      {error ? (
        <div className="p-4 bg-rose-950/60 border border-rose-500/40 rounded-2xl text-rose-200 text-xs flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={fetchUsers}
            className="px-3 py-1 bg-rose-900/60 hover:bg-rose-900 text-white rounded-lg cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      ) : loading && users.length === 0 ? (
        <div className="py-20 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs text-slate-400">Carregando usuários e permissões...</p>
        </div>
      ) : filteredUsers.length === 0 ? (
        <div className="py-16 text-center bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
          <div className="w-12 h-12 rounded-xl bg-slate-800 border border-slate-700 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-white">Nenhum usuário encontrado</p>
          <p className="text-xs text-slate-400 mt-1">Tente ajustar seus termos de busca ou filtros.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredUsers.map((user) => {
            const isSelf = user.id === currentProfile.id;
            const isAdminUser = user.role === 'admin';

            // Contar permissões ativas para usuário comum
            const activePermCount = isAdminUser
              ? 6
              : Object.values(user.permissions).filter(Boolean).length;

            return (
              <div
                key={user.id}
                className={`bg-slate-900 border rounded-2xl p-5 flex flex-col justify-between transition-all relative ${
                  !user.is_active
                    ? 'border-rose-900/40 opacity-75 bg-slate-950/80'
                    : isSelf
                    ? 'border-indigo-500/50 shadow-md shadow-indigo-500/5'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  {/* Topo do Card: Avatar, Nome, E-mail e Status */}
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ProfileAvatar name={user.full_name || 'Usuário'} size="md" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-bold text-sm text-white truncate max-w-[170px]">
                            {user.full_name || 'Sem nome'}
                          </h3>
                          {isSelf && (
                            <span className="px-1.5 py-0.2 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/40">
                              Você
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 truncate max-w-[200px]" title={user.email}>
                          {user.email || 'Sem e-mail'}
                        </p>
                      </div>
                    </div>

                    {/* Badge de Status Ativo/Inativo */}
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold border shrink-0 ${
                        user.is_active
                          ? 'bg-emerald-950/80 border-emerald-600/50 text-emerald-300'
                          : 'bg-rose-950/80 border-rose-600/50 text-rose-300'
                      }`}
                    >
                      {user.is_active ? 'Ativo' : 'Inativo'}
                    </span>
                  </div>

                  {/* Função do Usuário */}
                  <div className="flex items-center gap-2 mb-4">
                    {isAdminUser ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-purple-950/80 border border-purple-600/50 text-purple-300 text-xs font-semibold">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                        <span>Administrador</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 text-xs font-semibold">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <span>Usuário</span>
                      </span>
                    )}

                    <span className="text-[11px] text-slate-400">
                      {isAdminUser
                        ? 'Acesso total'
                        : `${activePermCount} de 6 permissões ativas`}
                    </span>
                  </div>

                  {/* Detalhe das Permissões */}
                  <div className="bg-slate-950/60 border border-slate-800/80 rounded-xl p-3 mb-4 space-y-2">
                    <span className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                      Permissões no CRM
                    </span>

                    {isAdminUser ? (
                      <p className="text-xs text-purple-300/90 font-medium">
                        Administradores possuem acesso total ao sistema.
                      </p>
                    ) : (
                      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                        <span className={`flex items-center gap-1.5 ${user.permissions.can_manage_notes ? 'text-emerald-400 font-medium' : 'text-slate-500 line-through'}`}>
                          <span>{user.permissions.can_manage_notes ? '✓' : '✕'}</span>
                          <span>Criar / editar notas</span>
                        </span>

                        <span className={`flex items-center gap-1.5 ${user.permissions.can_delete_notes ? 'text-emerald-400 font-medium' : 'text-slate-500 line-through'}`}>
                          <span>{user.permissions.can_delete_notes ? '✓' : '✕'}</span>
                          <span>Excluir notas</span>
                        </span>

                        <span className={`flex items-center gap-1.5 ${user.permissions.can_manage_leads ? 'text-emerald-400 font-medium' : 'text-slate-500 line-through'}`}>
                          <span>{user.permissions.can_manage_leads ? '✓' : '✕'}</span>
                          <span>Criar / editar condomínios</span>
                        </span>

                        <span className={`flex items-center gap-1.5 ${user.permissions.can_delete_leads ? 'text-emerald-400 font-medium' : 'text-slate-500 line-through'}`}>
                          <span>{user.permissions.can_delete_leads ? '✓' : '✕'}</span>
                          <span>Excluir condomínios</span>
                        </span>

                        <span className={`flex items-center gap-1.5 ${user.permissions.can_change_stage ? 'text-emerald-400 font-medium' : 'text-slate-500 line-through'}`}>
                          <span>{user.permissions.can_change_stage ? '✓' : '✕'}</span>
                          <span>Alterar estágio</span>
                        </span>

                        <span className={`flex items-center gap-1.5 ${user.permissions.can_manage_contacts ? 'text-emerald-400 font-medium' : 'text-slate-500 line-through'}`}>
                          <span>{user.permissions.can_manage_contacts ? '✓' : '✕'}</span>
                          <span>Gerenciar contatos</span>
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Rodapé do Card: Ações */}
                <div className="pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerateRecoveryLink(user)}
                    title="Gerar link de recuperação de acesso"
                    className="p-1.5 px-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-medium transition-colors cursor-pointer flex items-center gap-1.5"
                  >
                    <svg className="w-3.5 h-3.5 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    <span>Acesso</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleOpenEdit(user)}
                    className="px-3.5 py-1.5 bg-indigo-600/90 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5 shadow-sm"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                    <span>Gerenciar</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 1: GERENCIAR USUÁRIO & PERMISSÕES GRANULARES                    */}
      {/* ===================================================================== */}
      {editingUser && (
        <div
          onClick={() => setEditingUser(null)}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white">Gerenciar Usuário</h3>
                <p className="text-xs text-slate-400">{editingUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleSaveEdit} className="p-5 space-y-5 overflow-y-auto max-h-[75vh] custom-scrollbar text-xs">
              {editError && (
                <div className="p-3 bg-rose-950/80 border border-rose-600/60 rounded-xl text-rose-200 text-xs">
                  {editError}
                </div>
              )}

              {/* Nome e E-mail */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    Nome
                  </label>
                  <input
                    type="text"
                    required
                    value={editFullName}
                    onChange={(e) => setEditFullName(e.target.value)}
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-300 mb-1.5">
                    E-mail
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={editingUser.email}
                    className="w-full px-3.5 py-2.5 bg-slate-950/50 border border-slate-800/60 rounded-xl text-slate-400 text-xs cursor-not-allowed"
                  />
                </div>
              </div>

              {/* Função no Sistema */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Função
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    disabled={editingUser.id === currentProfile.id}
                    onClick={() => setEditRole('user')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      editRole === 'user'
                        ? 'bg-indigo-950/60 border-indigo-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    } ${editingUser.id === currentProfile.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div className="font-bold text-xs mb-0.5">Usuário</div>
                    <div className="text-[11px] opacity-80">Permissões definidas nas 6 chaves abaixo.</div>
                  </button>

                  <button
                    type="button"
                    disabled={editingUser.id === currentProfile.id}
                    onClick={() => setEditRole('admin')}
                    className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                      editRole === 'admin'
                        ? 'bg-purple-950/60 border-purple-500 text-white'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    } ${editingUser.id === currentProfile.id ? 'opacity-80' : ''}`}
                  >
                    <div className="font-bold text-xs mb-0.5 flex items-center justify-between">
                      <span>Administrador</span>
                      {editingUser.id === currentProfile.id && <span className="text-[9px] text-purple-300">Fixo</span>}
                    </div>
                    <div className="text-[11px] opacity-80">Acesso total ao sistema.</div>
                  </button>
                </div>
              </div>

              {/* Status Ativo/Inativo com Confirmação antes de desativar */}
              <div className="space-y-2">
                <div className="p-3.5 bg-slate-950/70 border border-slate-800 rounded-xl flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-slate-200">Status</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                          editIsActive
                            ? 'bg-emerald-950/80 border-emerald-600/50 text-emerald-300'
                            : 'bg-rose-950/80 border-rose-600/50 text-rose-300'
                        }`}
                      >
                        {editIsActive ? 'Ativo' : 'Inativo'}
                      </span>
                    </div>
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      {editIsActive
                        ? 'O usuário está ativo e pode operar no CRM.'
                        : 'O usuário está inativo e impedido de operar no CRM (histórico e autoria preservados).'}
                    </span>
                  </div>
                  <button
                    type="button"
                    disabled={editingUser.id === currentProfile.id}
                    onClick={() => {
                      if (editIsActive) {
                        setConfirmDeactivatePrompt(true);
                      } else {
                        setEditIsActive(true);
                        setConfirmDeactivatePrompt(false);
                      }
                    }}
                    className={`w-12 h-6 flex items-center rounded-full p-1 cursor-pointer transition-colors shrink-0 ${
                      editIsActive ? 'bg-emerald-600' : 'bg-slate-700'
                    } ${editingUser.id === currentProfile.id ? 'opacity-50 cursor-not-allowed' : ''}`}
                  >
                    <div
                      className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                        editIsActive ? 'translate-x-6' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {confirmDeactivatePrompt && editIsActive && (
                  <div className="p-3.5 bg-rose-950/70 border border-rose-500/50 rounded-xl space-y-2.5 animate-in fade-in duration-150">
                    <p className="text-xs text-rose-200 font-medium leading-relaxed">
                      Deseja desativar <strong>{editFullName || editingUser.email}</strong>? O histórico, autoria das notas e condomínios responsáveis serão mantidos, apenas impedindo a operação no CRM.
                    </p>
                    <div className="flex items-center justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setConfirmDeactivatePrompt(false)}
                        className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold cursor-pointer"
                      >
                        Manter ativo
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setEditIsActive(false);
                          setConfirmDeactivatePrompt(false);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                      >
                        Confirmar desativação
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Permissões Granulares ou Aviso de Administrador */}
              <div className="space-y-3 pt-2 border-t border-slate-800">
                {editRole === 'admin' ? (
                  <div className="p-4 bg-purple-950/40 border border-purple-500/40 rounded-xl flex items-center gap-3 text-purple-200">
                    <svg className="w-5 h-5 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="font-semibold text-xs">
                      Administradores possuem acesso total ao sistema.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Grupo: NOTAS */}
                    <div className="space-y-2">
                      <span className="block font-bold text-slate-400 text-[11px] uppercase tracking-wider">
                        NOTAS
                      </span>
                      <label className="flex items-center justify-between gap-3 p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl cursor-pointer hover:border-slate-700">
                        <div>
                          <span className="block font-semibold text-slate-200">Criar / editar notas</span>
                          <span className="text-[11px] text-slate-400">
                            Permite registrar novas anotações, agendar follow-ups e editar notas.
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={editPerms.can_manage_notes}
                          onChange={(e) => handleTogglePermission('can_manage_notes', e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer shrink-0"
                        />
                      </label>

                      <label className="flex items-center justify-between gap-3 p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl cursor-pointer hover:border-slate-700">
                        <div>
                          <span className="block font-semibold text-slate-200">Excluir notas</span>
                          <span className="text-[11px] text-slate-400">
                            Permite remover anotações do histórico do condomínio.
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={editPerms.can_delete_notes}
                          onChange={(e) => handleTogglePermission('can_delete_notes', e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer shrink-0"
                        />
                      </label>
                    </div>

                    {/* Grupo: CONDOMÍNIOS */}
                    <div className="space-y-2">
                      <span className="block font-bold text-slate-400 text-[11px] uppercase tracking-wider">
                        CONDOMÍNIOS
                      </span>
                      <label className="flex items-center justify-between gap-3 p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl cursor-pointer hover:border-slate-700">
                        <div>
                          <span className="block font-semibold text-slate-200">Criar / editar condomínios</span>
                          <span className="text-[11px] text-slate-400">
                            Permite cadastrar novos condomínios e alterar dados cadastrais.
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={editPerms.can_manage_leads}
                          onChange={(e) => handleTogglePermission('can_manage_leads', e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer shrink-0"
                        />
                      </label>

                      <label className="flex items-center justify-between gap-3 p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl cursor-pointer hover:border-slate-700">
                        <div>
                          <span className="block font-semibold text-slate-200">Excluir condomínios</span>
                          <span className="text-[11px] text-slate-400">
                            Permite remover condomínios do banco de dados.
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={editPerms.can_delete_leads}
                          onChange={(e) => handleTogglePermission('can_delete_leads', e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer shrink-0"
                        />
                      </label>
                    </div>

                    {/* Grupo: PIPELINE */}
                    <div className="space-y-2">
                      <span className="block font-bold text-slate-400 text-[11px] uppercase tracking-wider">
                        PIPELINE
                      </span>
                      <label className="flex items-center justify-between gap-3 p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl cursor-pointer hover:border-slate-700">
                        <div>
                          <span className="block font-semibold text-slate-200">Alterar estágio</span>
                          <span className="text-[11px] text-slate-400">
                            Permite mover condomínios entre etapas do pipeline e registrar perda.
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={editPerms.can_change_stage}
                          onChange={(e) => handleTogglePermission('can_change_stage', e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer shrink-0"
                        />
                      </label>
                    </div>

                    {/* Grupo: CONTATOS */}
                    <div className="space-y-2">
                      <span className="block font-bold text-slate-400 text-[11px] uppercase tracking-wider">
                        CONTATOS
                      </span>
                      <label className="flex items-center justify-between gap-3 p-3 bg-slate-950/50 border border-slate-800/80 rounded-xl cursor-pointer hover:border-slate-700">
                        <div>
                          <span className="block font-semibold text-slate-200">Gerenciar contatos</span>
                          <span className="text-[11px] text-slate-400">
                            Permite criar, editar, vincular e desvincular contatos.
                          </span>
                        </div>
                        <input
                          type="checkbox"
                          checked={editPerms.can_manage_contacts}
                          onChange={(e) => handleTogglePermission('can_manage_contacts', e.target.checked)}
                          className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 focus:ring-0 cursor-pointer shrink-0"
                        />
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Botões do Rodapé */}
              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md flex items-center gap-2"
                >
                  {editSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    'Salvar Alterações'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 2: CONVIDAR NOVO USUÁRIO                                        */}
      {/* ===================================================================== */}
      {isInviteModalOpen && (
        <div
          onClick={() => setIsInviteModalOpen(false)}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
          >
            {/* Header */}
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white">Convidar Novo Usuário</h3>
                <p className="text-xs text-slate-400">Adicione um novo membro à equipe do Triverus CRM</p>
              </div>
              <button
                type="button"
                onClick={() => setIsInviteModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {createdInviteResult ? (
              /* Sucesso com Link de Convite */
              <div className="p-6 space-y-4 text-xs">
                <div className="p-4 bg-emerald-950/80 border border-emerald-500/60 rounded-2xl text-emerald-200 space-y-2">
                  <div className="flex items-center gap-2 font-bold text-sm text-emerald-300">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Convite enviado com sucesso!</span>
                  </div>
                  <p>
                    O usuário <strong>{createdInviteResult.email}</strong> foi criado e suas permissões iniciais foram salvas. O próprio usuário definirá sua senha no primeiro acesso.
                  </p>
                </div>

                {createdInviteResult.inviteLink && (
                  <div className="space-y-2">
                    <label className="block font-semibold text-slate-300">
                      Link de Primeiro Acesso / Convite:
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={createdInviteResult.inviteLink}
                        className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-slate-300 text-xs font-mono select-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (createdInviteResult.inviteLink) {
                            navigator.clipboard.writeText(createdInviteResult.inviteLink);
                            showToast('Link copiado para a área de transferência!');
                          }
                        }}
                        className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold cursor-pointer shrink-0"
                      >
                        Copiar
                      </button>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      Envie este link ao usuário para que ele escolha sua própria senha e acesse o CRM.
                    </p>
                  </div>
                )}

                <div className="pt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Concluir
                  </button>
                </div>
              </div>
            ) : (
              /* Formulário de Convite */
              <form onSubmit={handleSaveInvite} className="p-5 space-y-4 overflow-y-auto max-h-[75vh] custom-scrollbar text-xs">
                {inviteError && (
                  <div className="p-3 bg-rose-950/80 border border-rose-600/60 rounded-xl text-rose-200 text-xs">
                    {inviteError}
                  </div>
                )}

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Nome *
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteFullName}
                    onChange={(e) => setInviteFullName(e.target.value)}
                    placeholder="Ex: Carlos Silva"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    E-mail *
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="carlos@triverus.com.br"
                    className="w-full px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>

                {/* Função */}
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Função
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setInviteRole('user')}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        inviteRole === 'user'
                          ? 'bg-indigo-950/60 border-indigo-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="font-bold text-xs mb-0.5">Usuário</div>
                      <div className="text-[11px] opacity-80">Permissões iniciais abaixo.</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setInviteRole('admin')}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        inviteRole === 'admin'
                          ? 'bg-purple-950/60 border-purple-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-400'
                      }`}
                    >
                      <div className="font-bold text-xs mb-0.5">Administrador</div>
                      <div className="text-[11px] opacity-80">Acesso total ao sistema.</div>
                    </button>
                  </div>
                </div>

                {/* Aviso de segurança sobre definição de senha pelo próprio usuário */}
                <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
                  <p className="text-[11px] text-slate-300 leading-relaxed">
                    Um convite/link de primeiro acesso será enviado para que o próprio usuário defina sua senha.
                  </p>
                </div>

                {/* Permissões iniciais ou aviso de Administrador */}
                {inviteRole === 'admin' ? (
                  <div className="p-4 bg-purple-950/40 border border-purple-500/40 rounded-xl flex items-center gap-3 text-purple-200">
                    <svg className="w-5 h-5 text-purple-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                    <span className="font-semibold text-xs">
                      Administradores possuem acesso total ao sistema.
                    </span>
                  </div>
                ) : (
                  <div className="space-y-3 pt-2 border-t border-slate-800">
                    <span className="block font-bold text-white uppercase text-[11px] tracking-wider">
                      Permissões Iniciais
                    </span>

                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <span className="block font-bold text-slate-400 text-[10px] uppercase tracking-wider">NOTAS</span>
                        <label className="flex items-center justify-between p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl cursor-pointer">
                          <span className="text-slate-200 font-medium">Criar / editar notas</span>
                          <input
                            type="checkbox"
                            checked={invitePerms.can_manage_notes}
                            onChange={(e) => setInvitePerms((p) => ({ ...p, can_manage_notes: e.target.checked }))}
                            className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 cursor-pointer"
                          />
                        </label>
                        <label className="flex items-center justify-between p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl cursor-pointer">
                          <span className="text-slate-200 font-medium">Excluir notas</span>
                          <input
                            type="checkbox"
                            checked={invitePerms.can_delete_notes}
                            onChange={(e) => setInvitePerms((p) => ({ ...p, can_delete_notes: e.target.checked }))}
                            className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 cursor-pointer"
                          />
                        </label>
                      </div>

                      <div className="space-y-1.5">
                        <span className="block font-bold text-slate-400 text-[10px] uppercase tracking-wider">CONDOMÍNIOS</span>
                        <label className="flex items-center justify-between p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl cursor-pointer">
                          <span className="text-slate-200 font-medium">Criar / editar condomínios</span>
                          <input
                            type="checkbox"
                            checked={invitePerms.can_manage_leads}
                            onChange={(e) => setInvitePerms((p) => ({ ...p, can_manage_leads: e.target.checked }))}
                            className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 cursor-pointer"
                          />
                        </label>
                        <label className="flex items-center justify-between p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl cursor-pointer">
                          <span className="text-slate-200 font-medium">Excluir condomínios</span>
                          <input
                            type="checkbox"
                            checked={invitePerms.can_delete_leads}
                            onChange={(e) => setInvitePerms((p) => ({ ...p, can_delete_leads: e.target.checked }))}
                            className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 cursor-pointer"
                          />
                        </label>
                      </div>

                      <div className="space-y-1.5">
                        <span className="block font-bold text-slate-400 text-[10px] uppercase tracking-wider">PIPELINE</span>
                        <label className="flex items-center justify-between p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl cursor-pointer">
                          <span className="text-slate-200 font-medium">Alterar estágio</span>
                          <input
                            type="checkbox"
                            checked={invitePerms.can_change_stage}
                            onChange={(e) => setInvitePerms((p) => ({ ...p, can_change_stage: e.target.checked }))}
                            className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 cursor-pointer"
                          />
                        </label>
                      </div>

                      <div className="space-y-1.5">
                        <span className="block font-bold text-slate-400 text-[10px] uppercase tracking-wider">CONTATOS</span>
                        <label className="flex items-center justify-between p-2.5 bg-slate-950/50 border border-slate-800 rounded-xl cursor-pointer">
                          <span className="text-slate-200 font-medium">Gerenciar contatos</span>
                          <input
                            type="checkbox"
                            checked={invitePerms.can_manage_contacts}
                            onChange={(e) => setInvitePerms((p) => ({ ...p, can_manage_contacts: e.target.checked }))}
                            className="w-4 h-4 text-indigo-600 rounded bg-slate-900 border-slate-700 cursor-pointer"
                          />
                        </label>
                      </div>
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setIsInviteModalOpen(false)}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={inviteSaving}
                    className="px-5 py-2 bg-[#FF6600] hover:bg-[#e65c00] disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md flex items-center gap-2"
                  >
                    {inviteSaving ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        <span>Enviando...</span>
                      </>
                    ) : (
                      'Enviar Convite'
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* MODAL 3: REDEFINIÇÃO DE ACESSO / RECUPERAÇÃO                          */}
      {/* ===================================================================== */}
      {resetModalUser && (
        <div
          onClick={() => setResetModalUser(null)}
          className="fixed inset-0 z-50 overflow-y-auto bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-150"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden my-6 flex flex-col"
          >
            <div className="px-5 py-4 border-b border-slate-800 bg-slate-950 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white">Gerenciar Acesso</h3>
                <p className="text-xs text-slate-400">{resetModalUser.email}</p>
              </div>
              <button
                type="button"
                onClick={() => setResetModalUser(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleExecuteResetPassword} className="p-5 space-y-4 text-xs">
              {resetError && (
                <div className="p-3 bg-rose-950/80 border border-rose-600/60 rounded-xl text-rose-200 text-xs">
                  {resetError}
                </div>
              )}
              {resetSuccessMsg && (
                <div className="p-3 bg-emerald-950/80 border border-emerald-600/60 rounded-xl text-emerald-200 text-xs">
                  {resetSuccessMsg}
                </div>
              )}

              {generatedRecoveryLink && (
                <div className="p-3 bg-slate-950 border border-slate-800 rounded-xl space-y-2">
                  <label className="block font-semibold text-slate-300">
                    Link de Recuperação de Senha:
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedRecoveryLink}
                      className="w-full px-3 py-2 bg-slate-900 border border-slate-700 rounded-lg text-xs font-mono text-slate-300 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedRecoveryLink);
                        showToast('Link de recuperação copiado!');
                      }}
                      className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold cursor-pointer shrink-0"
                    >
                      Copiar
                    </button>
                  </div>
                </div>
              )}

              <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-xl">
                <p className="text-[11px] text-slate-300 leading-relaxed">
                  Gere um link de recuperação/primeiro acesso para que o próprio usuário escolha e redefina sua senha pessoal.
                </p>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setResetModalUser(null)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs font-semibold cursor-pointer"
                >
                  Fechar
                </button>
                <button
                  type="submit"
                  disabled={resetSaving}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer shadow-md flex items-center gap-2"
                >
                  {resetSaving ? (
                    <>
                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      <span>Processando...</span>
                    </>
                  ) : (
                    'Gerar Link de Recuperação'
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
