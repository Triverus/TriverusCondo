-- ============================================================================
-- TRIVERUS — MIGRAÇÃO DOCUMENTAL E BUSCA INTELIGENTE DE AUDITORIA (ETAPA 3.1)
-- Arquivo: sql/20261110_auditoria_documentos_index.sql
-- 
-- ATENÇÃO DE SEGURANÇA E AMBIENTE:
-- ESTE SCRIPT FOI PREPARADO EXCLUSIVAMENTE PARA REVISÃO E APROVAÇÃO TÉCNICA.
-- NÃO EXECUTAR MIGRATIONS AUTOMÁTICAS E NÃO FAZER DEPLOY EM PRODUÇÃO.
-- ============================================================================

-- 1. Garantia de Unicidade Composta na Tabela Pai (auditoria_documentos)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_auditoria_documentos_id_condo'
  ) THEN
    ALTER TABLE public.auditoria_documentos
      ADD CONSTRAINT uq_auditoria_documentos_id_condo UNIQUE (id, condo_id);
  END IF;
END $$;

-- 2. Tabela de Controle de Estado, Fila e Publicação Atômica do Índice
CREATE TABLE IF NOT EXISTS public.auditoria_documentos_status (
  document_id UUID PRIMARY KEY,
  condo_id UUID NOT NULL,
  drive_file_id TEXT NOT NULL,
  drive_file_name TEXT NOT NULL,
  category TEXT NOT NULL,
  indexing_status TEXT NOT NULL DEFAULT 'pending', -- 'pending', 'indexing', 'indexed', 'sem_camada_texto', 'tamanho_excedido', 'erro_extracao'
  indexing_version INTEGER NOT NULL DEFAULT 1,
  active_version INTEGER NOT NULL DEFAULT 0,
  total_pages INTEGER DEFAULT 0,
  total_chunks INTEGER DEFAULT 0,
  total_chars INTEGER DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error TEXT,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  last_indexed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Restrição Relacional Composta: Impede divergência entre condomínio e documento pai
  CONSTRAINT fk_auditoria_doc_status_parent
    FOREIGN KEY (document_id, condo_id)
    REFERENCES public.auditoria_documentos(id, condo_id)
    ON DELETE CASCADE
);

-- 3. Tabela Principal do Índice Documental Fragmentado (Chunks)
CREATE TABLE IF NOT EXISTS public.auditoria_documentos_index (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL,
  condo_id UUID NOT NULL,
  drive_file_id TEXT NOT NULL,
  drive_file_name TEXT NOT NULL,
  category TEXT NOT NULL,
  page_number INTEGER NOT NULL CHECK (page_number > 0),
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  content TEXT NOT NULL,
  content_clean TEXT NOT NULL,
  char_count INTEGER NOT NULL DEFAULT 0,
  word_count INTEGER NOT NULL DEFAULT 0,
  indexing_status TEXT NOT NULL DEFAULT 'indexed',
  indexing_version INTEGER NOT NULL DEFAULT 1,
  file_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Restrição Relacional Composta: Impede divergência entre condomínio e documento pai
  CONSTRAINT fk_auditoria_doc_index_parent
    FOREIGN KEY (document_id, condo_id)
    REFERENCES public.auditoria_documentos(id, condo_id)
    ON DELETE CASCADE,

  -- Unicidade estrita por documento, versão, página e trecho
  CONSTRAINT uq_auditoria_doc_index_chunk
    UNIQUE (document_id, indexing_version, page_number, chunk_index)
);

-- 4. Índices de Desempenho e Busca Textual
CREATE INDEX IF NOT EXISTS idx_auditoria_doc_index_condo ON public.auditoria_documentos_index (condo_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_doc_index_doc ON public.auditoria_documentos_index (document_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_doc_index_category ON public.auditoria_documentos_index (category);
CREATE INDEX IF NOT EXISTS idx_auditoria_doc_index_doc_ver ON public.auditoria_documentos_index (document_id, indexing_version);
CREATE INDEX IF NOT EXISTS idx_auditoria_doc_index_page ON public.auditoria_documentos_index (document_id, page_number);
CREATE INDEX IF NOT EXISTS idx_auditoria_doc_index_status ON public.auditoria_documentos_index (indexing_status);

-- Índice de Busca Textual (Full-Text Search em Português)
CREATE INDEX IF NOT EXISTS idx_auditoria_doc_index_fts ON public.auditoria_documentos_index
  USING gin (to_tsvector('portuguese', content));

-- 5. Trigger para Sinalizar Atualização do Campo updated_at
CREATE OR REPLACE FUNCTION public.trg_auditoria_doc_index_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_doc_index_updated_at ON public.auditoria_documentos_index;
CREATE TRIGGER trg_auditoria_doc_index_updated_at
  BEFORE UPDATE ON public.auditoria_documentos_index
  FOR EACH ROW EXECUTE FUNCTION public.trg_auditoria_doc_index_updated_at();

-- 6. Habilitar RLS (Row Level Security)
ALTER TABLE public.auditoria_documentos_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.auditoria_documentos_status ENABLE ROW LEVEL SECURITY;

-- 7. Políticas RLS Alinhadas à Função Oficial public.can_user_access_condo(condo_id)
DROP POLICY IF EXISTS p_auditoria_doc_index_select ON public.auditoria_documentos_index;
CREATE POLICY p_auditoria_doc_index_select ON public.auditoria_documentos_index
  FOR SELECT
  TO authenticated
  USING (public.can_user_access_condo(condo_id));

DROP POLICY IF EXISTS p_auditoria_doc_status_select ON public.auditoria_documentos_status;
CREATE POLICY p_auditoria_doc_status_select ON public.auditoria_documentos_status
  FOR SELECT
  TO authenticated
  USING (public.can_user_access_condo(condo_id));

-- Nenhuma escrita é concedida a usuários comuns.
-- Inserção, edição e remoção gerenciadas estritamente por service_role (backend) ou Administradores Ativos.
DROP POLICY IF EXISTS p_auditoria_doc_index_admin_all ON public.auditoria_documentos_index;
CREATE POLICY p_auditoria_doc_index_admin_all ON public.auditoria_documentos_index
  FOR ALL
  TO authenticated
  USING (public.is_current_user_active_admin());

DROP POLICY IF EXISTS p_auditoria_doc_status_admin_all ON public.auditoria_documentos_status;
CREATE POLICY p_auditoria_doc_status_admin_all ON public.auditoria_documentos_status
  FOR ALL
  TO authenticated
  USING (public.is_current_user_active_admin());

-- 8. Povoamento Inicial Seguro para Documentos Já Vinculados
INSERT INTO public.auditoria_documentos_status (
  document_id,
  condo_id,
  drive_file_id,
  drive_file_name,
  category,
  indexing_status,
  indexing_version,
  active_version,
  created_at,
  updated_at
)
SELECT
  id,
  condo_id,
  drive_file_id,
  drive_file_name,
  category,
  'pending',
  1,
  0,
  now(),
  now()
FROM public.auditoria_documentos
ON CONFLICT (document_id) DO NOTHING;

-- 9. Função Stored Procedure de Publicação Atômica e Validação Estrita do Índice
-- Segue as melhores práticas oficiais do Supabase para SECURITY DEFINER: SET search_path = ''
CREATE OR REPLACE FUNCTION public.publish_auditoria_document_index_version(
  p_document_id UUID,
  p_condo_id UUID,
  p_new_version INTEGER,
  p_expected_chunks INTEGER,
  p_expected_pages INTEGER,
  p_expected_chars INTEGER,
  p_worker_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_status_rec RECORD;
  v_actual_chunks INTEGER;
  v_distinct_pages INTEGER;
  v_max_chunk_idx INTEGER;
BEGIN
  -- 1. Bloqueio Transacional Exclusivo na Linha do Documento (FOR UPDATE)
  SELECT * INTO v_status_rec
  FROM public.auditoria_documentos_status
  WHERE document_id = p_document_id AND condo_id = p_condo_id
  FOR UPDATE;

  -- 2. Validação de Existência do Registro de Controle
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: Registro de status do documento % não localizado para o condomínio %.', p_document_id, p_condo_id;
  END IF;

  -- 3. Validação de Propriedade da Trava pelo Worker Solicitante
  IF v_status_rec.locked_by IS NULL OR v_status_rec.locked_by <> p_worker_id THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: A trava da tarefa pertence a outro worker ou não foi adquirida. Solicitante: %, Gravado: %.', p_worker_id, COALESCE(v_status_rec.locked_by, 'NULL');
  END IF;

  -- 4. Validação da Validade Temporal da Trava (Trava expira em 10 minutos)
  IF v_status_rec.locked_at IS NULL OR v_status_rec.locked_at < (pg_catalog.now() - INTERVAL '10 minutes') THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: A trava do worker expirou temporalmente (limite de 10 minutos). Bloqueado em: %, Atual: %.', v_status_rec.locked_at, pg_catalog.now();
  END IF;

  -- 5. Validação do Estado do Documento
  IF v_status_rec.indexing_status <> 'indexing' THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: O documento não está em estado de indexação ativo. Estado atual: %.', v_status_rec.indexing_status;
  END IF;

  -- 6. Validação da Versão Reservada para Processamento
  -- A nova versão deve ser exatamente igual à versão de trabalho registrada em indexing_version
  IF p_new_version <> v_status_rec.indexing_version THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: A versão a publicar (%) diverge da versão reservada para processamento (%).', p_new_version, v_status_rec.indexing_version;
  END IF;

  -- A nova versão deve ser estritamente superior à versão ativa atualmente publicada
  IF p_new_version <= v_status_rec.active_version THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: Versão solicitada (%) deve ser maior que a versão ativa atual (%).', p_new_version, v_status_rec.active_version;
  END IF;

  -- 7. Validação das Quantidades Mínimas (> 0)
  IF p_expected_chunks <= 0 THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: Quantidade esperada de trechos deve ser maior que zero. Recebido: %.', p_expected_chunks;
  END IF;
  IF p_expected_pages <= 0 THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: Quantidade esperada de páginas deve ser maior que zero. Recebido: %.', p_expected_pages;
  END IF;

  -- 8. Validação e Auditoria da Integridade dos Dados Efetivamente Persistidos no Banco
  -- Não confiar apenas no que o worker declara: inspecionar o banco diretamente
  SELECT 
    COUNT(*),
    COUNT(DISTINCT page_number),
    MAX(chunk_index)
  INTO 
    v_actual_chunks,
    v_distinct_pages,
    v_max_chunk_idx
  FROM public.auditoria_documentos_index
  WHERE document_id = p_document_id
    AND condo_id = p_condo_id
    AND indexing_version = p_new_version;

  -- Comparação estrita de contagem total de trechos
  IF v_actual_chunks <> p_expected_chunks THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: Divergência na contagem de trechos. Esperados: %, Encontrados no banco: %.', p_expected_chunks, v_actual_chunks;
  END IF;

  -- Validação de que todas as páginas esperadas possuem trechos indexados
  IF v_distinct_pages < p_expected_pages THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: Páginas incompletas no índice. Esperadas: %, Páginas com trechos no banco: %.', p_expected_pages, v_distinct_pages;
  END IF;

  -- Validação de integridade do índice de chunks
  IF v_max_chunk_idx IS NULL OR v_max_chunk_idx < 0 THEN
    RAISE EXCEPTION 'PUBLICATION_ERROR: Falha estrutural nos índices dos trechos indexados.';
  END IF;

  -- 9. Atualização Atômica e Promoção da Versão Ativa
  UPDATE public.auditoria_documentos_status
  SET active_version = p_new_version,
      indexing_version = p_new_version,
      indexing_status = 'indexed',
      total_pages = p_expected_pages,
      total_chunks = p_expected_chunks,
      total_chars = p_expected_chars,
      last_error = NULL,
      locked_at = NULL,
      locked_by = NULL,
      last_indexed_at = pg_catalog.now(),
      updated_at = pg_catalog.now()
  WHERE document_id = p_document_id AND condo_id = p_condo_id;

  -- 10. Descarte Seguro dos Trechos da Versão Antiga Substituída
  DELETE FROM public.auditoria_documentos_index
  WHERE document_id = p_document_id
    AND condo_id = p_condo_id
    AND indexing_version < p_new_version;

END;
$$;

-- 10. Restrições de Segurança e Permissões Exclusivas Aplicadas Atomicamente
REVOKE ALL ON FUNCTION public.publish_auditoria_document_index_version(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_auditoria_document_index_version(UUID, UUID, INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO service_role, postgres;
