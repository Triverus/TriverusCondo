-- ==============================================================================
-- TRIVERUS CRM — MÓDULO DE AUDITORIA: PERSISTÊNCIA DEFINITIVA NO SUPABASE
-- Arquivo: sql/20261027_auditoria_folder_sync_and_multidoc.sql
--
-- ATENÇÃO CRÍTICA DE GOVERNANÇA E SEGURANÇA:
-- 1. REVISÃO DO DBA / ADMIN: Este script é preparado exclusivamente para revisão
--    técnica e aplicação manual no Supabase SQL Editor.
-- 2. NÃO-DESTRUTIVO: Proíbe exclusões automáticas (DELETE). Caso existam duplicatas,
--    interrompe a transação com RAISE EXCEPTION e preserva os dados originais.
-- 3. CHAVES ESTRANGEIRAS: Preserva as FKs existentes em public.auditoria_documentos
--    sem modificações silenciosas.
-- 4. FUNÇÕES SECURITY DEFINER HARDENED: search_path totalmente desativado (SET search_path = '') com qualificações explícitas de schema,
--    privilégios revogados de PUBLIC e anon e concedidos apenas a authenticated e service_role.
-- 5. POLÍTICAS RLS DETERMINÍSTICAS: Substitui apenas as 4 políticas legadas conhecidas
--    por versões seguras com isolamento comercial por condomínio. Não remove políticas desconhecidas.
-- ==============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. PERMISSÕES GRANULARES DE AUDITORIA EM public.user_permissions
-- ----------------------------------------------------------------------------
-- Cria as colunas com valor padrão FALSE (acesso fechado por padrão)
ALTER TABLE public.user_permissions
  ADD COLUMN IF NOT EXISTS can_access_auditoria BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_auditoria BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_permissions.can_access_auditoria IS
  'Permite ao colaborador visualizar o módulo de Auditoria e documentos dos condomínios sob sua responsabilidade (ou todos se admin ativo). Default false.';

COMMENT ON COLUMN public.user_permissions.can_manage_auditoria IS
  'Permite ao colaborador vincular pastas, sincronizar e desvincular documentos para condomínios sob sua responsabilidade. Default false.';

-- ----------------------------------------------------------------------------
-- 2. FUNÇÕES DE AUTORIZAÇÃO E ISOLAMENTO POR CONDOMÍNIO (SECURITY DEFINER)
-- ----------------------------------------------------------------------------
-- 2.1. Verifica se o usuário autenticado atual é um administrador ativo no sistema
CREATE OR REPLACE FUNCTION public.is_current_user_active_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.is_active = true
      AND p.deleted_at IS NULL
      AND (
        pg_catalog.lower(pg_catalog.btrim(COALESCE(p.role, ''))) = 'admin'
        OR
        pg_catalog.lower(pg_catalog.btrim(COALESCE(p.role, ''))) = 'administrador'
      )
  );
$$;

-- 2.2. Verifica se o usuário tem permissão para visualizar o condomínio e seus documentos
CREATE OR REPLACE FUNCTION public.can_user_access_condo(target_condo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
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
        AND p.is_active = true
        AND p.deleted_at IS NULL
        AND (up.can_access_auditoria = true OR up.can_manage_auditoria = true)
        AND l.responsible_user_id = auth.uid()
    )
  );
$$;

-- 2.3. Verifica se o usuário tem permissão para gerenciar (vincular/desvincular) documentos e pastas
CREATE OR REPLACE FUNCTION public.can_user_manage_condo_auditoria(target_condo_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
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
        AND p.is_active = true
        AND p.deleted_at IS NULL
        AND up.can_manage_auditoria = true
        AND l.responsible_user_id = auth.uid()
    )
  );
$$;

-- Proteção de execução das funções SECURITY DEFINER (revoga de PUBLIC e anon, restringe a authenticated e service_role)
REVOKE ALL ON FUNCTION public.is_current_user_active_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_current_user_active_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.is_current_user_active_admin() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_user_access_condo(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_user_access_condo(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_user_access_condo(UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_user_manage_condo_auditoria(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_user_manage_condo_auditoria(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_user_manage_condo_auditoria(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 3. EVOLUÇÃO NÃO DESTRUTIVA DA TABELA public.auditoria_documentos
-- ----------------------------------------------------------------------------
-- Criação da tabela base apenas caso não exista
CREATE TABLE IF NOT EXISTS public.auditoria_documentos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  drive_file_id VARCHAR(255) NOT NULL,
  drive_file_name VARCHAR(255) NOT NULL,
  drive_file_size BIGINT,
  drive_file_modified_at TIMESTAMPTZ,
  linked_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  origin_folder_id VARCHAR(255),
  origin_folder_name VARCHAR(255),
  sync_status VARCHAR(30) DEFAULT 'synced',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Adição não-destrutiva de colunas necessárias para sincronização por pastas
ALTER TABLE public.auditoria_documentos
  ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS drive_file_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS drive_file_size BIGINT,
  ADD COLUMN IF NOT EXISTS drive_file_modified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS linked_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS origin_folder_id VARCHAR(255),
  ADD COLUMN IF NOT EXISTS origin_folder_name VARCHAR(255),
  ADD COLUMN IF NOT EXISTS sync_status VARCHAR(30) DEFAULT 'synced',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- ----------------------------------------------------------------------------
-- 3.1. REMOÇÃO DINÂMICA DE RESTRIÇÕES DE UNICIDADE E ÍNDICES ÚNICOS LEGADOS
-- ----------------------------------------------------------------------------
-- Remoção dinâmica de QUAISQUER restrições únicas e índices únicos antigos que imponham
-- unicidade exclusivamente sobre (condo_id, category), independentemente do nome ou ordem das colunas.
-- REGRA DE SEGURANÇA:
-- 1. Realiza verificação prévia de índices únicos complexos (expressões ou predicados parciais) sobre condomínio e fase.
--    Caso exista algum que não possa ser removido com segurança automática, interrompe com RAISE EXCEPTION detalhado.
-- 2. Remove apenas objetos legados simples comprovadamente incompatíveis com múltiplos PDFs por fase.
-- 3. Preserva índices não únicos, índices com colunas adicionais (drive_file_id) e todos os registros.
DO $$
DECLARE
  r_ambiguous RECORD;
  r_constraint RECORD;
  r_index RECORD;
BEGIN
  -- 1. Verificação prévia de segurança: detecta índices únicos complexos (expressões ou parciais)
  -- cujas COLUNAS-CHAVE de unicidade incluam (condo_id e category) sem incluir drive_file_id nas chaves
  -- (distinguindo estritamente as colunas-chave do predicado WHERE da cláusula parcial usando unnest WITH ORDINALITY).
  SELECT i.relname AS index_name, pg_get_indexdef(x.indexrelid) AS index_def
  INTO r_ambiguous
  FROM pg_index x
  JOIN pg_class i ON i.oid = x.indexrelid
  JOIN pg_class t ON t.oid = x.indrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'auditoria_documentos'
    AND x.indisunique = true
    AND (x.indexprs IS NOT NULL OR x.indpred IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM pg_constraint c
      WHERE c.conindid = x.indexrelid AND c.conname = 'uq_auditoria_documentos_condo_cat_drive'
    )
    AND (
      -- As colunas-chave do índice contêm 'condo_id' e 'category'
      (
        EXISTS (
          SELECT 1
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          WHERE k.ord <= COALESCE(x.indnkeyatts, x.indnatts)
            AND a.attname = 'condo_id'
        )
        AND
        EXISTS (
          SELECT 1
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          WHERE k.ord <= COALESCE(x.indnkeyatts, x.indnatts)
            AND a.attname = 'category'
        )
      )
      OR
      -- Ou para índices baseados em expressões (x.indexprs IS NOT NULL),
      -- valida se a definição SQL contém condo_id e category
      (
        x.indexprs IS NOT NULL
        AND pg_get_indexdef(x.indexrelid) LIKE '%condo_id%'
        AND pg_get_indexdef(x.indexrelid) LIKE '%category%'
      )
    )
    AND NOT EXISTS (
      -- Garante que 'drive_file_id' NÃO faz parte das COLUNAS-CHAVE do índice
      -- (mesmo que apareça na cláusula WHERE do predicado parcial)
      SELECT 1
      FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE k.ord <= COALESCE(x.indnkeyatts, x.indnatts)
        AND a.attname = 'drive_file_id'
    )
  LIMIT 1;

  IF r_ambiguous.index_name IS NOT NULL THEN
    RAISE EXCEPTION E'MIGRAÇÃO INTERROMPIDA PARA REVISÃO MANUAL DE ÍNDICE ÚNICO:\nFoi encontrado o índice único "%" em public.auditoria_documentos que impõe unicidade sobre condomínio/fase utilizando expressões ou predicado parcial (WHERE) e não pode ser removido automaticamente com segurança.\n\nDefinição do Índice:\n  %\n\nProcedimento do DBA: Verifique se este índice é uma restrição legada de 1 documento por fase. Caso afirmativo, remova-o manualmente no SQL Editor antes de reexecutar este script.', r_ambiguous.index_name, r_ambiguous.index_def;
  END IF;

  -- 2. Remoção de constraints de unicidade legadas (tipo 'u') cujas colunas chave sejam exatamente {condo_id, category} em qualquer ordem
  FOR r_constraint IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'auditoria_documentos'
      AND c.contype = 'u'
      AND cardinality(c.conkey) = 2
      AND (
        SELECT ARRAY(
          SELECT a.attname
          FROM unnest(c.conkey) AS k(attnum)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          ORDER BY a.attname
        )
      ) = ARRAY['category', 'condo_id']
  ) LOOP
    EXECUTE format('ALTER TABLE public.auditoria_documentos DROP CONSTRAINT IF EXISTS %I', r_constraint.conname);
  END LOOP;

  -- 3. Remoção de índices únicos autônomos simples (indisunique = true, sem constraint de tabela vinculada)
  -- cujas colunas chave de unicidade sejam exatamente {condo_id, category} em qualquer ordem,
  -- ignorando colunas INCLUDE, expressões indexadas ou predicados de índices parciais (WHERE).
  FOR r_index IN (
    SELECT i.relname AS index_name
    FROM pg_index x
    JOIN pg_class i ON i.oid = x.indexrelid
    JOIN pg_class t ON t.oid = x.indrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'auditoria_documentos'
      AND x.indisunique = true
      AND x.indexprs IS NULL -- exclui índices com expressões
      AND x.indpred IS NULL  -- exclui índices parciais (com cláusula WHERE)
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.conindid = x.indexrelid
      )
      AND COALESCE(x.indnkeyatts, x.indnatts) = 2 -- exatamente 2 colunas participando da chave de unicidade
      AND (
        SELECT ARRAY(
          SELECT a.attname
          FROM unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          WHERE k.ord <= COALESCE(x.indnkeyatts, x.indnatts)
          ORDER BY a.attname
        )
      ) = ARRAY['category', 'condo_id']
  ) LOOP
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r_index.index_name);
  END LOOP;
END $$;

-- 3.1. VERIFICAÇÃO DE SEGURANÇA: DETECÇÃO DE DUPLICATAS EM public.auditoria_documentos
-- REGRA: PROIBIDO EXCLUIR AUTOMATICAMENTE. Se houver duplicatas de (condo_id, category, drive_file_id),
-- a migração é abortada com relatório detalhado para resolução manual.
DO $$
DECLARE
  v_dup_count BIGINT;
  v_dup_samples TEXT;
BEGIN
  SELECT count(*), string_agg(format('condo_id: %s | category: %s | drive_file_id: %s (total: %s ocorrências)', condo_id, category, drive_file_id, cnt), E'\n  ')
  INTO v_dup_count, v_dup_samples
  FROM (
    SELECT condo_id, category, drive_file_id, count(*) as cnt
    FROM public.auditoria_documentos
    WHERE drive_file_id IS NOT NULL
    GROUP BY condo_id, category, drive_file_id
    HAVING count(*) > 1
    LIMIT 5
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION E'MIGRAÇÃO INTERROMPIDA COM SEGURANÇA:\nForam encontradas % chave(s) com registros duplicados em public.auditoria_documentos para (condo_id, category, drive_file_id).\nNenhum registro foi excluído automaticamente. Os dados permanecem intactos.\nExemplos de duplicatas encontradas:\n  %\n\nProcedimento: Regularize manualmente as duplicatas antes de reaplicar o script.', v_dup_count, v_dup_samples;
  END IF;
END $$;

-- Aplicação da nova restrição de unicidade para múltiplos documentos (único por condomínio, categoria e arquivo)
-- Confirma que a constraint com este nome pertence à tabela public.auditoria_documentos, possui tipo 'u' e colunas esperadas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'auditoria_documentos'
      AND c.conname = 'uq_auditoria_documentos_condo_cat_drive'
      AND c.contype = 'u'
      AND cardinality(c.conkey) = 3
      AND (
        SELECT ARRAY(
          SELECT a.attname
          FROM unnest(c.conkey) AS k(attnum)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          ORDER BY a.attname
        )
      ) = ARRAY['category', 'condo_id', 'drive_file_id']
  ) THEN
    ALTER TABLE public.auditoria_documentos
      ADD CONSTRAINT uq_auditoria_documentos_condo_cat_drive
      UNIQUE (condo_id, category, drive_file_id);
  END IF;
END $$;

-- Índices otimizados para consulta rápida e deleção seletiva de documentos
CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_condo_cat
  ON public.auditoria_documentos (condo_id, category);

CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_drive_file
  ON public.auditoria_documentos (drive_file_id);

CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_origin_folder
  ON public.auditoria_documentos (condo_id, origin_folder_id);

-- ----------------------------------------------------------------------------
-- 4. TABELA DE VÍNCULOS DE PASTAS DO GOOGLE DRIVE: public.auditoria_fase_pastas
-- ----------------------------------------------------------------------------
-- COMPORTAMENTO DE EXCLUSÃO DE CONDOMÍNIOS (LEADS):
-- A chave estrangeira condo_id referencia public.leads(id) ON DELETE CASCADE.
-- Consistência com o modelo existente:
-- Quando um condomínio (lead) for excluído no CRM:
-- 1. Todos os registros de vínculos de pastas em public.auditoria_fase_pastas deste condomínio são automaticamente excluídos.
-- 2. Todos os registros de documentos em public.auditoria_documentos deste condomínio são automaticamente excluídos.
-- 3. Os arquivos físicos e pastas originais no Google Drive JAMAIS são afetados ou removidos pelo CRM.
-- 4. Quando um colaborador (profile) for excluído ou desativado: linked_by_user_id é definido como NULL (ON DELETE SET NULL),
--    preservando intactos os vínculos e o histórico documental do condomínio.
CREATE TABLE IF NOT EXISTS public.auditoria_fase_pastas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  drive_folder_id VARCHAR(255) NOT NULL,
  drive_folder_name VARCHAR(255) NOT NULL,
  linked_by_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4.1. VERIFICAÇÃO DE SEGURANÇA: DETECÇÃO DE DUPLICATAS EM public.auditoria_fase_pastas
-- REGRA: PROIBIDO EXCLUIR AUTOMATICAMENTE. Se houver mais de uma pasta vinculada para a mesma fase,
-- a migração é abortada com relatório detalhado para resolução manual.
DO $$
DECLARE
  v_dup_count BIGINT;
  v_dup_samples TEXT;
BEGIN
  SELECT count(*), string_agg(format('condo_id: %s | category: %s (total: %s pastas vinculadas)', condo_id, category, cnt), E'\n  ')
  INTO v_dup_count, v_dup_samples
  FROM (
    SELECT condo_id, category, count(*) as cnt
    FROM public.auditoria_fase_pastas
    GROUP BY condo_id, category
    HAVING count(*) > 1
    LIMIT 5
  ) dups;

  IF v_dup_count > 0 THEN
    RAISE EXCEPTION E'MIGRAÇÃO INTERROMPIDA COM SEGURANÇA:\nForam encontradas % chave(s) com registros duplicados em public.auditoria_fase_pastas para (condo_id, category).\nNenhum registro foi excluído automaticamente. Os dados permanecem intactos.\nExemplos de duplicatas encontradas:\n  %\n\nProcedimento: Regularize manualmente os vínculos antes de reaplicar o script.', v_dup_count, v_dup_samples;
  END IF;
END $$;

-- Aplicação da restrição de unicidade: no máximo 1 pasta vinculada por categoria em cada condomínio
-- Confirma que a constraint com este nome pertence à tabela public.auditoria_fase_pastas, possui tipo 'u' e colunas esperadas
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public'
      AND t.relname = 'auditoria_fase_pastas'
      AND c.conname = 'uq_auditoria_fase_pastas_condo_cat'
      AND c.contype = 'u'
      AND cardinality(c.conkey) = 2
      AND (
        SELECT ARRAY(
          SELECT a.attname
          FROM unnest(c.conkey) AS k(attnum)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
          ORDER BY a.attname
        )
      ) = ARRAY['category', 'condo_id']
  ) THEN
    ALTER TABLE public.auditoria_fase_pastas
      ADD CONSTRAINT uq_auditoria_fase_pastas_condo_cat
      UNIQUE (condo_id, category);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_auditoria_fase_pastas_condo
  ON public.auditoria_fase_pastas (condo_id);

-- ----------------------------------------------------------------------------
-- 5. POLÍTICAS DE SEGURANÇA ROW LEVEL SECURITY (RLS)
-- ----------------------------------------------------------------------------
-- Ativação mandatória de RLS em ambas as tabelas
ALTER TABLE public.auditoria_documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_fase_pastas ENABLE ROW LEVEL SECURITY;

-- 5.1. Substituição pontual e justificada das políticas em public.auditoria_documentos
-- JUSTIFICATIVA TÉCNICA:
-- As políticas legadas ("auditoria_documentos_select", "auditoria_documentos_insert",
-- "auditoria_documentos_update", "auditoria_documentos_delete") criadas pelo script inicial
-- permitiam leitura a qualquer usuário ativo do CRM e exigiam permissão genérica can_manage_leads,
-- sem isolamento comercial por condomínio.
-- As novas políticas substituem exclusivamente essas 4 políticas legadas e suas versões idempotentes,
-- garantindo isolamento estrito por condomínio (leads.responsible_user_id = auth.uid()) e
-- permissões granulares de Auditoria (can_access_auditoria e can_manage_auditoria).
-- Nenhuma política externa ou desconhecida é removida.

DROP POLICY IF EXISTS "auditoria_documentos_select" ON public.auditoria_documentos;
DROP POLICY IF EXISTS "auditoria_documentos_insert" ON public.auditoria_documentos;
DROP POLICY IF EXISTS "auditoria_documentos_update" ON public.auditoria_documentos;
DROP POLICY IF EXISTS "auditoria_documentos_delete" ON public.auditoria_documentos;

DROP POLICY IF EXISTS "auditoria_documentos_select_policy" ON public.auditoria_documentos;
DROP POLICY IF EXISTS "auditoria_documentos_insert_policy" ON public.auditoria_documentos;
DROP POLICY IF EXISTS "auditoria_documentos_update_policy" ON public.auditoria_documentos;
DROP POLICY IF EXISTS "auditoria_documentos_delete_policy" ON public.auditoria_documentos;

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

-- 5.2. Políticas de segurança na nova tabela public.auditoria_fase_pastas
DROP POLICY IF EXISTS "auditoria_fase_pastas_select_policy" ON public.auditoria_fase_pastas;
DROP POLICY IF EXISTS "auditoria_fase_pastas_insert_policy" ON public.auditoria_fase_pastas;
DROP POLICY IF EXISTS "auditoria_fase_pastas_update_policy" ON public.auditoria_fase_pastas;
DROP POLICY IF EXISTS "auditoria_fase_pastas_delete_policy" ON public.auditoria_fase_pastas;

CREATE POLICY "auditoria_fase_pastas_select_policy"
  ON public.auditoria_fase_pastas
  FOR SELECT
  TO authenticated
  USING (public.can_user_access_condo(condo_id));

CREATE POLICY "auditoria_fase_pastas_insert_policy"
  ON public.auditoria_fase_pastas
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_fase_pastas_update_policy"
  ON public.auditoria_fase_pastas
  FOR UPDATE
  TO authenticated
  USING (public.can_user_manage_condo_auditoria(condo_id))
  WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

CREATE POLICY "auditoria_fase_pastas_delete_policy"
  ON public.auditoria_fase_pastas
  FOR DELETE
  TO authenticated
  USING (public.can_user_manage_condo_auditoria(condo_id));

-- ----------------------------------------------------------------------------
-- 6. REGULAÇÃO DE PRIVILÉGIOS DAS TABELAS
-- ----------------------------------------------------------------------------
-- Garante que 'PUBLIC' e 'anon' não possuam nenhum privilégio direto ou herdado.
-- Concede estritamente os privilégios DML necessários a 'authenticated' (cujo acesso
-- é delimitado em nível de linha pelas políticas RLS) e 'service_role' (backend administrativo).
REVOKE ALL ON TABLE public.auditoria_documentos FROM PUBLIC;
REVOKE ALL ON TABLE public.auditoria_fase_pastas FROM PUBLIC;
REVOKE ALL ON TABLE public.auditoria_documentos FROM anon;
REVOKE ALL ON TABLE public.auditoria_fase_pastas FROM anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auditoria_documentos TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.auditoria_fase_pastas TO authenticated, service_role;

COMMIT;
