import React, { createContext, useContext, useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from './supabase.ts';
import type { UserProfile } from '../App.tsx';

export interface UserPermissions {
  user_id: string;
  can_manage_notes: boolean;
  can_delete_notes: boolean;
  can_manage_leads: boolean;
  can_delete_leads: boolean;
  can_change_stage: boolean;
  can_manage_contacts: boolean;
  created_at?: string;
  updated_at?: string;
}

export const DEFAULT_USER_PERMISSIONS: Omit<UserPermissions, 'user_id'> = {
  can_manage_notes: true,
  can_delete_notes: false,
  can_manage_leads: true,
  can_delete_leads: false,
  can_change_stage: true,
  can_manage_contacts: true,
};

export const ADMIN_FULL_PERMISSIONS: Omit<UserPermissions, 'user_id'> = {
  can_manage_notes: true,
  can_delete_notes: true,
  can_manage_leads: true,
  can_delete_leads: true,
  can_change_stage: true,
  can_manage_contacts: true,
};

interface PermissionsContextType {
  permissions: UserPermissions | null;
  isAdmin: boolean;
  loading: boolean;
  canManageNotes: boolean;
  canDeleteNotes: boolean;
  canManageLeads: boolean;
  canDeleteLeads: boolean;
  canChangeStage: boolean;
  canManageContacts: boolean;
  /** Função exclusiva de Administrador conforme decisão de produto */
  canManageUsers: boolean;
  reloadPermissions: () => Promise<void>;
}

const PermissionsContext = createContext<PermissionsContextType | null>(null);

export function PermissionsProvider({
  children,
  currentProfile,
}: {
  children: React.ReactNode;
  currentProfile: UserProfile | null;
}) {
  const isAdmin = useMemo(() => {
    if (!currentProfile?.role) return false;
    const r = currentProfile.role.trim().toLowerCase();
    return r === 'admin' || r === 'administrador';
  }, [currentProfile?.role]);

  const [permissions, setPermissions] = useState<UserPermissions | null>(() => {
    if (!currentProfile?.id) return null;
    return {
      user_id: currentProfile.id,
      ...(isAdmin ? ADMIN_FULL_PERMISSIONS : DEFAULT_USER_PERMISSIONS),
    };
  });

  const [loading, setLoading] = useState<boolean>(false);

  const fetchPermissions = useCallback(async () => {
    if (!currentProfile?.id) {
      setPermissions(null);
      return;
    }

    if (isAdmin) {
      setPermissions({
        user_id: currentProfile.id,
        ...ADMIN_FULL_PERMISSIONS,
      });
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_permissions')
        .select('*')
        .eq('user_id', currentProfile.id)
        .maybeSingle();

      if (error) {
        console.warn('Erro ao carregar permissões granulares:', error.message);
        setPermissions((prev) => prev || {
          user_id: currentProfile.id,
          ...DEFAULT_USER_PERMISSIONS,
        });
      } else if (data) {
        setPermissions({
          user_id: data.user_id,
          can_manage_notes: Boolean(data.can_manage_notes),
          can_delete_notes: Boolean(data.can_delete_notes),
          can_manage_leads: Boolean(data.can_manage_leads),
          can_delete_leads: Boolean(data.can_delete_leads),
          can_change_stage: Boolean(data.can_change_stage),
          can_manage_contacts: Boolean(data.can_manage_contacts),
          created_at: data.created_at,
          updated_at: data.updated_at,
        });
      } else {
        // Fallback para novo perfil sem registro explícito
        setPermissions({
          user_id: currentProfile.id,
          ...DEFAULT_USER_PERMISSIONS,
        });
      }
    } catch (err: any) {
      console.warn('Exceção ao buscar permissões do usuário:', err?.message || err);
      setPermissions((prev) => prev || {
        user_id: currentProfile.id,
        ...DEFAULT_USER_PERMISSIONS,
      });
    } finally {
      setLoading(false);
    }
  }, [currentProfile?.id, isAdmin]);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const value = useMemo<PermissionsContextType>(() => {
    const p = permissions || (isAdmin ? ADMIN_FULL_PERMISSIONS : DEFAULT_USER_PERMISSIONS);
    return {
      permissions,
      isAdmin,
      loading,
      canManageNotes: isAdmin || Boolean(p.can_manage_notes),
      canDeleteNotes: isAdmin || Boolean(p.can_delete_notes),
      canManageLeads: isAdmin || Boolean(p.can_manage_leads),
      canDeleteLeads: isAdmin || Boolean(p.can_delete_leads),
      canChangeStage: isAdmin || Boolean(p.can_change_stage),
      canManageContacts: isAdmin || Boolean(p.can_manage_contacts),
      canManageUsers: isAdmin,
      reloadPermissions: fetchPermissions,
    };
  }, [permissions, isAdmin, loading, fetchPermissions]);

  return (
    <PermissionsContext.Provider value={value}>
      {children}
    </PermissionsContext.Provider>
  );
}

export function useUserPermissions(): PermissionsContextType {
  const ctx = useContext(PermissionsContext);
  if (!ctx) {
    // Retorno seguro caso esteja fora do provider
    return {
      permissions: null,
      isAdmin: false,
      loading: false,
      canManageNotes: true,
      canDeleteNotes: false,
      canManageLeads: true,
      canDeleteLeads: false,
      canChangeStage: true,
      canManageContacts: true,
      canManageUsers: false,
      reloadPermissions: async () => {},
    };
  }
  return ctx;
}

export const usePermissions = useUserPermissions;

