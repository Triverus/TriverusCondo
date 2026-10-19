-- ==============================================================================
-- MIGRATION: user_deletion_and_authorship_archive
-- Objetivo:
-- 1. Desacoplar public.profiles(id) da deleção em cascata de auth.users(id),
--    permitindo que contas auth.users sejam excluídas do Supabase Auth
--    sem apagar o histórico de autoria (created_by_user_id / last_edited_by_user_id)
--    nem disparar erros de integridade referencial com public.interactions.
-- 2. Assegurar que public.profiles continue como repositório canônico de nomes de autores.
-- 3. Adicionar coluna deleted_at em public.profiles para auditoria de desligamento.
-- ==============================================================================

-- 1. Identificar e remover a foreign key de profiles para auth.users (profiles_id_fkey)
DO $$
DECLARE
  v_constraint text;
BEGIN
  SELECT tc.constraint_name INTO v_constraint
  FROM information_schema.table_constraints tc
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'profiles'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND ccu.table_schema = 'auth'
    AND ccu.table_name = 'users';

  IF v_constraint IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT %I;', v_constraint);
  END IF;
END;
$$;

-- 2. Adicionar coluna deleted_at em public.profiles para auditoria
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL;

-- 3. Assegurar política de exclusão por administradores em public.profiles
DROP POLICY IF EXISTS "profiles_delete_admin" ON public.profiles;
CREATE POLICY "profiles_delete_admin" ON public.profiles
  FOR DELETE TO authenticated USING (public.is_admin());

-- 4. Assegurar permissão de atualização e deleção para authenticated
GRANT SELECT, INSERT, UPDATE, DELETE ON public.interactions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.leads TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.google_calendar_connections TO authenticated;
