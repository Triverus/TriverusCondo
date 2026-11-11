-- ============================================================================
-- TRIVERUS — MIGRAÇÃO SQL: REMOÇÃO DA RESTRIÇÃO DE ENUMERADO FECHADO
-- Tabela: public.leads | Coluna: lead_source
-- Objetivo: Permitir texto livre em "Origem do Lead" sem falha de constraint
-- Data: 2026-11-11
-- ============================================================================

-- Remover a restrição de verificação fechada leads_lead_source_check
-- A restrição limitava os valores a: 'Indicação (BNI/rede)', 'Prospecção ativa', 'Conteúdo/Marketing', 'Outro'.
-- Com esta remoção, qualquer texto livre informado pelo usuário é aceito de forma segura.
ALTER TABLE public.leads 
  DROP CONSTRAINT IF EXISTS leads_lead_source_check;

COMMENT ON COLUMN public.leads.lead_source IS 
  'Origem comercial do lead (texto livre opcional, ex: Indicação BNI, Prospecção Ativa, Evento, Site, etc)';
