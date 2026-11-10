-- ==============================================================================
-- MIGRATION: 5 Global Agents Architecture for Triverus Platform (Definitive)
-- Version: 20261101000000
-- Description:
--   1. Triverus possui exatamente 5 posições de agentes no total (slot_number 1..5),
--      compartilhados por todos os usuários da organização.
--   2. Persistência autoritativa exclusiva no Supabase. Sem propriedade individual por user_id.
--   3. model_id permite NULL (sem modelo padrão imposto); a execução é bloqueada
--      caso o administrador ainda não tenha selecionado um modelo válido do catálogo.
--   4. Reutiliza as funções de segurança existentes no Supabase de produção:
--      - public.is_active_user(): valida se o usuário autenticado está ativo.
--      - public.is_admin(): valida se role = 'admin' e is_active = true.
--      (Não redefine ou substitui nenhuma dessas funções existentes).
--   5. Atribuições de agentes (agent_assignments):
--      - CHECK constraint exige category_key IS NULL quando target = 'chat'
--        e category_key NOT NULL / não vazio quando target = 'auditoria'.
--      - Permite múltiplos agentes habilitados simultaneamente para o Chat.
--      - Auditoria restrita a exatamente 1 especialista por categoria documental.
--   6. Políticas RLS granulares: leitura para usuários ativos (is_active_user)
--      e mutações exclusivas para administradores ativos (is_admin).
--
-- ATENÇÃO: NÃO EXECUTAR DIRETAMENTE EM PRODUÇÃO SEM VALIDAÇÃO E APROVAÇÃO.
-- ==============================================================================

-- 1. TABELA DE AGENTES GLOBAIS (ATÉ 5 POSIÇÕES NA PLATAFORMA INTEIRA)
CREATE TABLE IF NOT EXISTS public.custom_agents (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  slot_number SMALLINT NOT NULL CHECK (slot_number BETWEEN 1 AND 5) UNIQUE,
  name TEXT NOT NULL CHECK (char_length(trim(name)) > 0),
  role VARCHAR(34) NOT NULL CHECK (char_length(trim(role)) > 0 AND char_length(role) <= 34),
  prompt TEXT NOT NULL DEFAULT '',
  brain_profile VARCHAR(20) NOT NULL DEFAULT 'balanced' CHECK (brain_profile IN ('economic', 'balanced', 'advanced')),
  model_id VARCHAR(50) DEFAULT NULL, -- Nullable: modelo deve ser selecionado explicitamente pelo catálogo
  avatar_url TEXT,
  avatar_id VARCHAR(50),
  is_configured BOOLEAN NOT NULL DEFAULT true,
  is_official BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. TRIGGER DE ATUALIZAÇÃO AUTOMÁTICA DE updated_at E updated_by
CREATE OR REPLACE FUNCTION public.handle_agent_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := NOW();
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_custom_agents_updated_at ON public.custom_agents;
CREATE TRIGGER trg_custom_agents_updated_at
  BEFORE UPDATE ON public.custom_agents
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_agent_updated_at();

-- 3. TABELA DE ATRIBUIÇÕES DE AGENTES (AGENT ASSIGNMENTS)
CREATE TABLE IF NOT EXISTS public.agent_assignments (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  agent_id TEXT NOT NULL REFERENCES public.custom_agents(id) ON DELETE CASCADE,
  target VARCHAR(20) NOT NULL CHECK (target IN ('chat', 'auditoria')),
  category_key VARCHAR(100),
  category_label VARCHAR(150),
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_agent_assignments_target_category CHECK (
    (target = 'chat' AND category_key IS NULL) OR
    (target = 'auditoria' AND category_key IS NOT NULL AND char_length(trim(category_key)) > 0)
  )
);

-- 4. ÍNDICES DE UNICIDADE
-- Chat: permite atribuir múltiplos agentes ao Chat (um registro por agente)
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_assignments_chat 
  ON public.agent_assignments (agent_id, target) 
  WHERE target = 'chat';

-- Auditoria: exatamente 1 agente especialista ativo por categoria de documento
CREATE UNIQUE INDEX IF NOT EXISTS uq_agent_assignments_auditoria 
  ON public.agent_assignments (target, category_key) 
  WHERE target = 'auditoria';

-- 5. CONCESSÃO DE PERMISSÕES NAS TABELAS
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_agents TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_assignments TO authenticated, service_role;

-- 6. HABILITAÇÃO DE ROW LEVEL SECURITY (RLS)
ALTER TABLE public.custom_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_assignments ENABLE ROW LEVEL SECURITY;

-- 7. POLÍTICAS RLS PARA custom_agents (REUTILIZANDO is_active_user E is_admin EXISTENTES)
DROP POLICY IF EXISTS "custom_agents_select_active" ON public.custom_agents;
CREATE POLICY "custom_agents_select_active" ON public.custom_agents
  FOR SELECT TO authenticated
  USING (public.is_active_user() IS TRUE);

DROP POLICY IF EXISTS "custom_agents_insert_admin" ON public.custom_agents;
CREATE POLICY "custom_agents_insert_admin" ON public.custom_agents
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() IS TRUE);

DROP POLICY IF EXISTS "custom_agents_update_admin" ON public.custom_agents;
CREATE POLICY "custom_agents_update_admin" ON public.custom_agents
  FOR UPDATE TO authenticated
  USING (public.is_admin() IS TRUE)
  WITH CHECK (public.is_admin() IS TRUE);

DROP POLICY IF EXISTS "custom_agents_delete_admin" ON public.custom_agents;
CREATE POLICY "custom_agents_delete_admin" ON public.custom_agents
  FOR DELETE TO authenticated
  USING (public.is_admin() IS TRUE);

-- 8. POLÍTICAS RLS PARA agent_assignments (REUTILIZANDO is_active_user E is_admin EXISTENTES)
DROP POLICY IF EXISTS "agent_assignments_select_active" ON public.agent_assignments;
CREATE POLICY "agent_assignments_select_active" ON public.agent_assignments
  FOR SELECT TO authenticated
  USING (public.is_active_user() IS TRUE);

DROP POLICY IF EXISTS "agent_assignments_insert_admin" ON public.agent_assignments;
CREATE POLICY "agent_assignments_insert_admin" ON public.agent_assignments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() IS TRUE);

DROP POLICY IF EXISTS "agent_assignments_update_admin" ON public.agent_assignments;
CREATE POLICY "agent_assignments_update_admin" ON public.agent_assignments
  FOR UPDATE TO authenticated
  USING (public.is_admin() IS TRUE)
  WITH CHECK (public.is_admin() IS TRUE);

DROP POLICY IF EXISTS "agent_assignments_delete_admin" ON public.agent_assignments;
CREATE POLICY "agent_assignments_delete_admin" ON public.agent_assignments
  FOR DELETE TO authenticated
  USING (public.is_admin() IS TRUE);
