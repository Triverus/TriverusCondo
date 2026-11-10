-- ============================================================================
-- TRIVERUS — MIGRATION: public.agent_capabilities
-- Tabela de capacidades configuráveis por agente global no Motor Universal
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.agent_capabilities (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES public.custom_agents(id) ON DELETE CASCADE,
  capability_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_agent_capabilities UNIQUE (agent_id, capability_key)
);

-- Índices para buscas por agente
CREATE INDEX IF NOT EXISTS idx_agent_capabilities_agent_id ON public.agent_capabilities(agent_id);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.agent_capabilities ENABLE ROW LEVEL SECURITY;

-- Políticas de RLS separadas
DROP POLICY IF EXISTS "agent_capabilities_select_policy" ON public.agent_capabilities;
CREATE POLICY "agent_capabilities_select_policy"
  ON public.agent_capabilities
  FOR SELECT
  TO authenticated
  USING (public.is_active_user() IS TRUE);

DROP POLICY IF EXISTS "agent_capabilities_insert_policy" ON public.agent_capabilities;
CREATE POLICY "agent_capabilities_insert_policy"
  ON public.agent_capabilities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin() IS TRUE);

DROP POLICY IF EXISTS "agent_capabilities_update_policy" ON public.agent_capabilities;
CREATE POLICY "agent_capabilities_update_policy"
  ON public.agent_capabilities
  FOR UPDATE
  TO authenticated
  USING (public.is_admin() IS TRUE)
  WITH CHECK (public.is_admin() IS TRUE);

DROP POLICY IF EXISTS "agent_capabilities_delete_policy" ON public.agent_capabilities;
CREATE POLICY "agent_capabilities_delete_policy"
  ON public.agent_capabilities
  FOR DELETE
  TO authenticated
  USING (public.is_admin() IS TRUE);

-- Permissões GRANT explícitas
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_capabilities TO authenticated;
GRANT ALL ON public.agent_capabilities TO service_role;

