-- ==============================================================================
-- MIGRATION FINAL: user_permissions_and_authorship
-- 1. profiles (email, is_active, trigger de proteção contra escalada de privilégios)
-- 2. user_permissions (regras granulares e políticas seguras)
-- 3. autoria real em interactions (created_by_user_id, last_edited_by_user_id, last_edited_at)
-- 4. funções de segurança com search_path seguro
-- 5. stage guard baseado em jsonb (sem lista parcial de colunas)
-- 6. limpeza determinística de TODAS as policies antigas nas 8 tabelas
-- 7. novas políticas RLS canônicas
-- 8. inicialização sem backfill falso
-- ==============================================================================

-- 1. ESTRUTURA BÁSICA: EMAIL E STATUS ATIVO EM PROFILES
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND (p.email IS NULL OR p.email = '');

-- 2. TABELA DE PERMISSÕES GRANULARES
CREATE TABLE IF NOT EXISTS public.user_permissions (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  can_manage_notes BOOLEAN NOT NULL DEFAULT true,      -- Criar / editar notas
  can_delete_notes BOOLEAN NOT NULL DEFAULT false,     -- Excluir notas
  can_manage_leads BOOLEAN NOT NULL DEFAULT true,      -- Criar / editar condomínios
  can_delete_leads BOOLEAN NOT NULL DEFAULT false,     -- Excluir condomínios
  can_change_stage BOOLEAN NOT NULL DEFAULT true,      -- Alterar estágio do pipeline
  can_manage_contacts BOOLEAN NOT NULL DEFAULT true,   -- Gerenciar contatos
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. AUTORIA HUMANA NAS INTERACTIONS
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS last_edited_by_user_id UUID REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS last_edited_at TIMESTAMPTZ;

-- NOTA: Nenhum backfill falso é executado nas notas históricas.
-- created_by_user_id, last_edited_by_user_id e last_edited_at permanecem NULL para notas pré-existentes.

-- 4. FUNÇÕES DE SEGURANÇA (SECURITY DEFINER + search_path seguro)
CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT p.is_active 
     FROM public.profiles p 
     WHERE p.id = auth.uid()),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT (p.role = 'admin') 
     FROM public.profiles p 
     WHERE p.id = auth.uid() AND p.is_active = true),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.has_permission(permission_name text)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_is_active boolean;
  v_is_admin boolean;
  v_has_perm boolean := false;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN false;
  END IF;

  SELECT p.is_active, (p.role = 'admin')
  INTO v_is_active, v_is_admin
  FROM public.profiles p
  WHERE p.id = auth.uid();

  IF v_is_active IS NOT TRUE THEN
    RETURN false;
  END IF;

  -- Administrador ativo possui acesso total por função
  IF v_is_admin IS TRUE THEN
    RETURN true;
  END IF;

  -- Usuário comum: consultar valor na tabela user_permissions
  EXECUTE format(
    'SELECT coalesce(%I, false) FROM public.user_permissions WHERE user_id = $1',
    permission_name
  )
  INTO v_has_perm
  USING auth.uid();

  RETURN coalesce(v_has_perm, false);
END;
$$;

-- 5. TRIGGERS DE SEGURANÇA EM PROFILES (Contra escalada de privilégios)
CREATE OR REPLACE FUNCTION public.handle_profile_insert_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.id := auth.uid();
    -- Se for criado pelo próprio usuário no client-side, força role 'user'
    IF NOT (public.is_admin()) THEN
      NEW.role := 'user';
      NEW.is_active := true;
    END IF;
  END IF;
  NEW.created_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_insert_guard ON public.profiles;
CREATE TRIGGER trg_profile_insert_guard
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_insert_guard();

CREATE OR REPLACE FUNCTION public.handle_profile_update_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.created_at := OLD.created_at;

  -- Usuário comum NÃO pode alterar role, status ativo ou email diretamente
  IF NOT (public.is_admin()) THEN
    NEW.role := OLD.role;
    NEW.is_active := OLD.is_active;
    NEW.email := OLD.email;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_update_guard ON public.profiles;
CREATE TRIGGER trg_profile_update_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_update_guard();

-- 5.1. TRIGGER DE INICIALIZAÇÃO AUTOMÁTICA DE PERMISSÕES (Fallback à prova de falhas)
CREATE OR REPLACE FUNCTION public.handle_profile_permissions_init()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.user_permissions (
    user_id,
    can_manage_notes,
    can_delete_notes,
    can_manage_leads,
    can_delete_leads,
    can_change_stage,
    can_manage_contacts
  ) VALUES (
    NEW.id,
    true,
    CASE WHEN NEW.role = 'admin' THEN true ELSE false END,
    true,
    CASE WHEN NEW.role = 'admin' THEN true ELSE false END,
    true,
    true
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_profile_permissions_init ON public.profiles;
CREATE TRIGGER trg_profile_permissions_init
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_profile_permissions_init();

-- 6. TRIGGER DE AUTORIA HUMANA INVIOLÁVEL EM INTERACTIONS
CREATE OR REPLACE FUNCTION public.handle_interaction_authorship()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Ignora qualquer valor enviado pelo cliente; força auth.uid()
    IF auth.uid() IS NOT NULL THEN
      NEW.created_by_user_id := auth.uid();
    END IF;
    NEW.last_edited_by_user_id := NULL;
    NEW.last_edited_at := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Imutabilidade do autor da criação
    NEW.created_by_user_id := OLD.created_by_user_id;

    -- Apenas alterações em campos humanos geram marcação de última edição
    IF (NEW.notes IS DISTINCT FROM OLD.notes) OR
       (NEW.interaction_type IS DISTINCT FROM OLD.interaction_type) OR
       (NEW.occurred_at IS DISTINCT FROM OLD.occurred_at) OR
       (NEW.next_follow_up_date IS DISTINCT FROM OLD.next_follow_up_date) OR
       (NEW.next_follow_up_at IS DISTINCT FROM OLD.next_follow_up_at) OR
       (NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id) THEN
      IF auth.uid() IS NOT NULL THEN
        NEW.last_edited_by_user_id := auth.uid();
      ELSE
        NEW.last_edited_by_user_id := coalesce(NEW.last_edited_by_user_id, OLD.last_edited_by_user_id);
      END IF;
      NEW.last_edited_at := now();
    ELSE
      -- Sincronizações automáticas (ex: gravação de google_event_id): preservam o estado anterior
      NEW.last_edited_by_user_id := OLD.last_edited_by_user_id;
      NEW.last_edited_at := OLD.last_edited_at;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_interaction_authorship ON public.interactions;
CREATE TRIGGER trg_interaction_authorship
  BEFORE INSERT OR UPDATE ON public.interactions
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_interaction_authorship();

-- 7. TRIGGER DE PROTEÇÃO ROBUSTA DE ESTÁGIO EM LEADS (Comparação JSONB)
CREATE OR REPLACE FUNCTION public.handle_lead_stage_change_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_old_json jsonb;
  v_new_json jsonb;
BEGIN
  -- Se for operação sem sessão (service_role) ou se for administrador, libera
  IF auth.uid() IS NULL OR public.is_admin() THEN
    RETURN NEW;
  END IF;

  -- Se possui permissão plena de gerenciar condomínios, libera edição completa
  IF public.has_permission('can_manage_leads') IS TRUE THEN
    RETURN NEW;
  END IF;

  -- Se possui apenas permissão de alterar estágio:
  IF public.has_permission('can_change_stage') IS TRUE THEN
    -- Remove exclusivamente as colunas permitidas no fluxo de movimentação de funil
    v_old_json := to_jsonb(OLD) - 'current_stage_id' - 'loss_reason' - 'updated_at';
    v_new_json := to_jsonb(NEW) - 'current_stage_id' - 'loss_reason' - 'updated_at';

    -- Se qualquer outra coluna diferir, aborta a transação com erro explicativo
    IF v_old_json IS DISTINCT FROM v_new_json THEN
      RAISE EXCEPTION 'Permissão insuficiente: seu usuário tem permissão apenas para alterar o estágio deste condomínio.';
    END IF;

    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Permissão negada para atualizar condomínio.';
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_stage_change_guard ON public.leads;
CREATE TRIGGER trg_lead_stage_change_guard
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_lead_stage_change_guard();

-- 8. REMOÇÃO DETERMINÍSTICA DE TODAS AS POLICIES ANTIGAS NAS 8 TABELAS
-- 8.1. Drop explícito nominal das 11 policies reais auditadas no banco de produção
DROP POLICY IF EXISTS "Authenticated users can manage contacts" ON public.contacts;
DROP POLICY IF EXISTS "Authenticated users can manage interactions" ON public.interactions;
DROP POLICY IF EXISTS "Authenticated users can manage lead contacts" ON public.lead_contacts;
DROP POLICY IF EXISTS "Authenticated users can manage lead services" ON public.lead_services;
DROP POLICY IF EXISTS "Authenticated users can create leads" ON public.leads;
DROP POLICY IF EXISTS "Authenticated users can delete leads" ON public.leads;
DROP POLICY IF EXISTS "Authenticated users can update leads" ON public.leads;
DROP POLICY IF EXISTS "Authenticated users can view leads" ON public.leads;
DROP POLICY IF EXISTS "Authenticated users can view profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view stage history" ON public.stage_history;

-- 8.2. Varredura dinâmica de segurança em pg_policies para garantir que nenhuma policy residual persista
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'interactions', 'leads', 'contacts', 'lead_contacts', 
        'profiles', 'user_permissions', 'stage_history', 'lead_services'
      )
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I;', r.policyname, r.schemaname, r.tablename);
  END LOOP;
END;
$$;

-- 9. APLICAÇÃO DAS POLÍTICAS RLS CANÔNICAS

-- PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select_active" ON public.profiles
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "profiles_insert_self_restricted" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "profiles_update_self_or_admin" ON public.profiles
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR auth.uid() = id)
  WITH CHECK (public.is_admin() OR auth.uid() = id);

-- USER_PERMISSIONS
ALTER TABLE public.user_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_permissions_select" ON public.user_permissions
  FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "user_permissions_admin_all" ON public.user_permissions
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- INTERACTIONS
ALTER TABLE public.interactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "interactions_select" ON public.interactions
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "interactions_insert" ON public.interactions
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('can_manage_notes'));
CREATE POLICY "interactions_update" ON public.interactions
  FOR UPDATE TO authenticated
  USING (public.has_permission('can_manage_notes'))
  WITH CHECK (public.has_permission('can_manage_notes'));
CREATE POLICY "interactions_delete" ON public.interactions
  FOR DELETE TO authenticated USING (public.has_permission('can_delete_notes'));

-- LEADS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_select" ON public.leads
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "leads_insert" ON public.leads
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('can_manage_leads'));
CREATE POLICY "leads_update" ON public.leads
  FOR UPDATE TO authenticated
  USING (public.has_permission('can_manage_leads') OR public.has_permission('can_change_stage'))
  WITH CHECK (public.has_permission('can_manage_leads') OR public.has_permission('can_change_stage'));
CREATE POLICY "leads_delete" ON public.leads
  FOR DELETE TO authenticated USING (public.has_permission('can_delete_leads'));

-- CONTACTS
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_select" ON public.contacts
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "contacts_write" ON public.contacts
  FOR ALL TO authenticated
  USING (public.has_permission('can_manage_contacts'))
  WITH CHECK (public.has_permission('can_manage_contacts'));

-- LEAD_CONTACTS
ALTER TABLE public.lead_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_contacts_select" ON public.lead_contacts
  FOR SELECT TO authenticated USING (public.is_active_user());
CREATE POLICY "lead_contacts_write" ON public.lead_contacts
  FOR ALL TO authenticated
  USING (public.has_permission('can_manage_contacts'))
  WITH CHECK (public.has_permission('can_manage_contacts'));

-- LEAD_SERVICES
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'lead_services') THEN
    EXECUTE 'ALTER TABLE public.lead_services ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'CREATE POLICY "lead_services_select" ON public.lead_services FOR SELECT TO authenticated USING (public.is_active_user());';
    EXECUTE 'CREATE POLICY "lead_services_write" ON public.lead_services FOR ALL TO authenticated USING (public.has_permission(''can_manage_leads'')) WITH CHECK (public.has_permission(''can_manage_leads''));';
  END IF;
END;
$$;

-- STAGE_HISTORY
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stage_history') THEN
    EXECUTE 'ALTER TABLE public.stage_history ENABLE ROW LEVEL SECURITY;';
    EXECUTE 'CREATE POLICY "stage_history_select" ON public.stage_history FOR SELECT TO authenticated USING (public.is_active_user());';
    EXECUTE 'CREATE POLICY "stage_history_insert" ON public.stage_history FOR INSERT TO authenticated WITH CHECK (public.has_permission(''can_change_stage'') OR public.has_permission(''can_manage_leads''));';
    EXECUTE 'CREATE POLICY "stage_history_admin_mod" ON public.stage_history FOR UPDATE TO authenticated USING (public.is_admin());';
    EXECUTE 'CREATE POLICY "stage_history_admin_del" ON public.stage_history FOR DELETE TO authenticated USING (public.is_admin());';
  END IF;
END;
$$;

-- 10. INICIALIZAR PERMISSÕES PARA OS USUÁRIOS ATUAIS
INSERT INTO public.user_permissions (
  user_id,
  can_manage_notes,
  can_delete_notes,
  can_manage_leads,
  can_delete_leads,
  can_change_stage,
  can_manage_contacts
)
SELECT 
  p.id,
  true,
  CASE WHEN p.role = 'admin' THEN true ELSE false END,
  true,
  CASE WHEN p.role = 'admin' THEN true ELSE false END,
  true,
  true
FROM public.profiles p
ON CONFLICT (user_id) DO NOTHING;
