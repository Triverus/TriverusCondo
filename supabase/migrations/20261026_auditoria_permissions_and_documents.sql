-- ============================================================================
-- TRIVERUS CRM — MÓDULO DE AUDITORIA: MIGRAÇÃO CONSOLIDADA E NÃO DESTRUTIVA
-- Arquivo: sql/20261026_auditoria_permissions_and_documents.sql
-- 
-- ATENÇÃO CRÍTICA DE EXECUÇÃO:
-- ESTE SCRIPT FOI PREPARADO EXCLUSIVAMENTE PARA REVISÃO E AVALIAÇÃO TÉCNICA.
-- NÃO DEVE SER APLICADO EM PRODUÇÃO SEM APROVAÇÃO EXPLÍCITA.
-- ============================================================================

-- 1. NOVAS COLUNAS GRANULARES NA TABELA public.user_permissions
ALTER TABLE public.user_permissions
  ADD COLUMN IF NOT EXISTS can_access_auditoria BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_auditoria BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_permissions.can_access_auditoria IS
  'Permite ao colaborador visualizar o módulo de Auditoria e documentos vinculados a condomínios sob sua responsabilidade (ou todos se admin ativo).';

COMMENT ON COLUMN public.user_permissions.can_manage_auditoria IS
  'Permite ao colaborador vincular, desvincular documentos e solicitar execuções de IA para condomínios sob sua responsabilidade.';

-- 2. FUNÇÕES DE SUPORTE À AUTORIZAÇÃO E ISOLAMENTO (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.is_current_user_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active IS NOT FALSE
      AND p.deleted_at IS NULL
      AND (lower(trim(p.role)) = 'admin' OR lower(trim(p.role)) = 'administrador')
  );
$$;

CREATE OR REPLACE FUNCTION public.can_user_access_condo(target_condo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT (
    public.is_current_user_active_admin()
    OR
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_permissions up ON up.user_id = p.id
      JOIN public.leads l ON l.id = target_condo_id
      WHERE p.id = auth.uid()
        AND p.is_active IS NOT FALSE
        AND p.deleted_at IS NULL
        AND (up.can_access_auditoria = true OR up.can_manage_auditoria = true)
        AND l.responsible_user_id = auth.uid()
        AND l.deleted_at IS NULL
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.can_user_manage_condo_auditoria(target_condo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT (
    public.is_current_user_active_admin()
    OR
    EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.user_permissions up ON up.user_id = p.id
      JOIN public.leads l ON l.id = target_condo_id
      WHERE p.id = auth.uid()
        AND p.is_active IS NOT FALSE
        AND p.deleted_at IS NULL
        AND up.can_manage_auditoria = true
        AND l.responsible_user_id = auth.uid()
        AND l.deleted_at IS NULL
    )
  );
$$;

-- 3. EVOLUÇÃO NÃO DESTRUTIVA DA TABELA public.auditoria_documentos
CREATE TABLE IF NOT EXISTS public.auditoria_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  category VARCHAR(50) NOT NULL,
  drive_file_id VARCHAR(255) NOT NULL,
  drive_file_name VARCHAR(255) NOT NULL,
  drive_file_size BIGINT,
  drive_file_modified_at TIMESTAMPTZ,
  linked_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.auditoria_documentos
  ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS drive_file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS drive_file_size BIGINT,
  ADD COLUMN IF NOT EXISTS drive_file_modified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Remoção dinâmica de QUALQUER constraint ou índice único que limite a 1 documento por (condo_id, category)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'auditoria_documentos'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname ORDER BY array_position(c.conkey, a.attnum))
        FROM pg_attribute a
        WHERE a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
      ) = ARRAY['condo_id', 'category']
  ) LOOP
    EXECUTE format('ALTER TABLE public.auditoria_documentos DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_auditoria_documentos_condo_cat_drive'
  ) THEN
    ALTER TABLE public.auditoria_documentos
      ADD CONSTRAINT uq_auditoria_documentos_condo_cat_drive
      UNIQUE (condo_id, category, drive_file_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_condo_cat
  ON public.auditoria_documentos (condo_id, category);

CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_drive_file
  ON public.auditoria_documentos (drive_file_id);

-- 4. POLÍTICAS RLS PARA public.auditoria_documentos
ALTER TABLE public.auditoria_documentos ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN (
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'auditoria_documentos'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.auditoria_documentos', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY "auditoria_documentos_select_policy"
  ON public.auditoria_documentos
  FOR SELECT
  TO authenticated
  USING (public.can_user_access_condo(condo_id));

CREATE POLICY "auditoria_documentos_insert_policy"
  ON public.auditoria_documentos
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_documentos_update_policy"
  ON public.auditoria_documentos
  FOR UPDATE
  TO authenticated
  USING (public.can_user_manage_condo_auditoria(condo_id))
  WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_documentos_delete_policy"
  ON public.auditoria_documentos
  FOR DELETE
  TO authenticated
  USING (public.can_user_manage_condo_auditoria(condo_id));

-- 5. ESTRUTURA PARA AGENTES PERSONALIZADOS E EXECUÇÕES DE IA
CREATE TABLE IF NOT EXISTS public.auditoria_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  personality TEXT,
  instructions TEXT NOT NULL,
  model_id VARCHAR(50) NOT NULL DEFAULT 'gemini-2.5-flash',
  depth_level VARCHAR(20) NOT NULL DEFAULT 'padrao',
  authorized_tools JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_archived BOOLEAN NOT NULL DEFAULT false,
  created_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auditoria_agent_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES public.auditoria_agents(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  snapshot_data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.auditoria_ai_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  agent_id UUID REFERENCES public.auditoria_agents(id) ON DELETE SET NULL,
  agent_version_id UUID REFERENCES public.auditoria_agent_versions(id) ON DELETE SET NULL,
  phase_id VARCHAR(50) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  provider VARCHAR(50) NOT NULL DEFAULT 'google',
  model_id VARCHAR(100) NOT NULL DEFAULT 'gemini-2.5-flash',
  model_version VARCHAR(50),
  input_tokens INT DEFAULT NULL,
  output_tokens INT DEFAULT NULL,
  duration_ms INT DEFAULT NULL,
  cost_estimated_cents INT DEFAULT NULL,
  cost_real_cents INT DEFAULT NULL, -- NULL indica ausência de aferição; nunca 0 como default
  currency VARCHAR(10) NOT NULL DEFAULT 'USD',
  exchange_rate_brl NUMERIC(10, 4) DEFAULT NULL,
  token_usage JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  requested_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auditoria_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  execution_id UUID NOT NULL REFERENCES public.auditoria_ai_executions(id) ON DELETE CASCADE,
  condo_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE RESTRICT,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  sender_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.auditoria_condo_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id UUID NOT NULL UNIQUE REFERENCES public.leads(id) ON DELETE RESTRICT,
  profile_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger de integridade cross-condo
CREATE OR REPLACE FUNCTION public.trg_check_chat_message_condo_integrity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_exec_condo_id UUID;
BEGIN
  SELECT condo_id INTO v_exec_condo_id
  FROM public.auditoria_ai_executions
  WHERE id = NEW.execution_id;

  IF v_exec_condo_id IS NULL THEN
    RAISE EXCEPTION 'Execução de IA vinculada % não localizada', NEW.execution_id;
  END IF;

  IF NEW.condo_id <> v_exec_condo_id THEN
    RAISE EXCEPTION 'Violação de integridade cross-condo: o condomínio da mensagem (%) diverge do condomínio da execução (%)', NEW.condo_id, v_exec_condo_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_chat_message_condo_integrity ON public.auditoria_chat_messages;
CREATE TRIGGER trg_chat_message_condo_integrity
  BEFORE INSERT OR UPDATE ON public.auditoria_chat_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_check_chat_message_condo_integrity();

-- 6. RLS NAS DEMAIS TABELAS
ALTER TABLE public.auditoria_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_agent_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_ai_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_condo_profiles ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['auditoria_agents', 'auditoria_agent_versions', 'auditoria_ai_executions', 'auditoria_chat_messages', 'auditoria_condo_profiles'] LOOP
    FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

CREATE POLICY "auditoria_agents_select" ON public.auditoria_agents
  FOR SELECT TO authenticated USING (public.can_user_access_condo(condo_id));

CREATE POLICY "auditoria_agents_insert" ON public.auditoria_agents
  FOR INSERT TO authenticated WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_agents_update" ON public.auditoria_agents
  FOR UPDATE TO authenticated USING (public.can_user_manage_condo_auditoria(condo_id))
  WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_agents_delete" ON public.auditoria_agents
  FOR DELETE TO authenticated USING (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_versions_select" ON public.auditoria_agent_versions
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.auditoria_agents a
      WHERE a.id = auditoria_agent_versions.agent_id
        AND public.can_user_access_condo(a.condo_id)
    )
  );

CREATE POLICY "auditoria_versions_insert" ON public.auditoria_agent_versions
  FOR INSERT TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.auditoria_agents a
      WHERE a.id = auditoria_agent_versions.agent_id
        AND public.can_user_manage_condo_auditoria(a.condo_id)
    )
  );

CREATE POLICY "auditoria_ai_executions_select" ON public.auditoria_ai_executions
  FOR SELECT TO authenticated USING (public.can_user_access_condo(condo_id));

CREATE POLICY "auditoria_ai_executions_insert" ON public.auditoria_ai_executions
  FOR INSERT TO authenticated WITH CHECK (
    public.can_user_manage_condo_auditoria(condo_id)
    AND requested_by_user_id = auth.uid()
    AND status = 'pending'
    AND cost_real_cents IS NULL
  );

CREATE POLICY "chat_messages_select" ON public.auditoria_chat_messages
  FOR SELECT TO authenticated USING (public.can_user_access_condo(condo_id));

CREATE POLICY "chat_messages_insert_user_only" ON public.auditoria_chat_messages
  FOR INSERT TO authenticated WITH CHECK (
    role = 'user'
    AND sender_user_id = auth.uid()
    AND public.can_user_access_condo(condo_id)
  );

CREATE POLICY "auditoria_profiles_select" ON public.auditoria_condo_profiles
  FOR SELECT TO authenticated USING (public.can_user_access_condo(condo_id));

CREATE POLICY "auditoria_profiles_insert" ON public.auditoria_condo_profiles
  FOR INSERT TO authenticated WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_profiles_update" ON public.auditoria_condo_profiles
  FOR UPDATE TO authenticated USING (public.can_user_manage_condo_auditoria(condo_id))
  WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

-- 7. PROCEDIMENTO DE ROLLBACK NÃO DESTRUTIVO
/*
-- Para remover as políticas de RLS criadas:
DO $$
DECLARE
  t TEXT;
  pol RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['auditoria_documentos', 'auditoria_agents', 'auditoria_agent_versions', 'auditoria_ai_executions', 'auditoria_chat_messages', 'auditoria_condo_profiles'] LOOP
    FOR pol IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t) LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, t);
    END LOOP;
  END LOOP;
END $$;

-- ALTER TABLE public.auditoria_documentos DROP CONSTRAINT IF EXISTS uq_auditoria_documentos_condo_cat_drive;
-- ALTER TABLE public.user_permissions DROP COLUMN IF EXISTS can_access_auditoria;
-- ALTER TABLE public.user_permissions DROP COLUMN IF EXISTS can_manage_auditoria;
*/
