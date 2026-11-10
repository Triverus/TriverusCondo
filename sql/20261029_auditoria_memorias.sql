-- ============================================================================
-- TRIVERUS CRM — MÓDULO DE AUDITORIA: MIGRAÇÃO CONSOLIDADA DAS MEMÓRIAS
-- Arquivo: sql/20261029_auditoria_memorias.sql
-- Data: 2026-10-30
--
-- ATENÇÃO CRÍTICA DE GOVERNANÇA:
-- 1. Este script foi preparado exclusivamente para revisão técnica prévia à
--    aplicação manual no Supabase SQL Editor.
-- 2. Não execute em produção sem validação prévia pelo Administrador do Banco.
-- 3. Idempotente e Estritamente Íntegro: suporta tanto a criação inicial do zero
--    quanto a evolução segura de uma tabela public.auditoria_memorias preexistente.
-- 4. Equivalência e Unicidade de Constraints: elimina duplicidade de restrições CHECK,
--    garantindo exatamente uma constraint nomeada para cada regra de validação.
-- 5. Validação Abrangente de Foreign Key: detecta qualquer FK que envolva a coluna
--    local condo_id (inclusive chaves compostas), aceita unicamente a FK canônica
--    (public.leads(id) ON DELETE CASCADE) e aborta com erro explícito se houver
--    FK composta ou divergente, sem remoções silenciosas.
-- 6. Interrupção Explícita por Inconsistência: se houver registros prévios que violem
--    a integridade referencial ou regras de preenchimento, a transação é abortada com
--    RAISE EXCEPTION imediato, sem suposições ou alterações silenciosas.
-- 7. RLS Canônico: alinhado com as funções de autorização public.can_user_access_condo
--    e public.can_user_manage_condo_auditoria.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. CRIAÇÃO BASE DA TABELA public.auditoria_memorias (CENÁRIO TABELA NOVA)
-- ----------------------------------------------------------------------------
-- Observação: as validações de fill_mode e status são definidas exclusivamente
-- de forma nomeada e controlada nas seções 3.4 e 3.5, evitando duplicidade de CHECKs.
CREATE TABLE IF NOT EXISTS public.auditoria_memorias (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    condo_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    label VARCHAR(255) NOT NULL,
    fill_mode VARCHAR(20) NOT NULL DEFAULT 'ai',
    manual_value TEXT,
    instruction TEXT,
    source_document_id UUID,
    source_drive_file_id VARCHAR(255),
    source_drive_file_name VARCHAR(255),
    last_result TEXT,
    page_reference TEXT,
    last_result_metadata JSONB,
    status VARCHAR(30) NOT NULL DEFAULT 'never_searched',
    last_executed_at TIMESTAMPTZ,
    source_file_modified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by UUID,
    CONSTRAINT chk_auditoria_memoria_consistency CHECK (
        (
            fill_mode = 'manual' 
            AND manual_value IS NOT NULL 
            AND length(trim(manual_value)) > 0
            AND instruction IS NULL
            AND source_drive_file_id IS NULL
        )
        OR
        (
            fill_mode = 'ai' 
            AND manual_value IS NULL
            AND instruction IS NOT NULL 
            AND length(trim(instruction)) > 0
            AND source_drive_file_id IS NOT NULL 
            AND length(trim(source_drive_file_id)) > 0
        )
    )
);

-- ----------------------------------------------------------------------------
-- 2. GARANTIA DE COLUNAS EM TABELAS PREEXISTENTES
-- ----------------------------------------------------------------------------
-- Adiciona defensivamente colunas faltantes sem sobrescrever dados preexistentes
ALTER TABLE public.auditoria_memorias
    ADD COLUMN IF NOT EXISTS id UUID,
    ADD COLUMN IF NOT EXISTS condo_id UUID,
    ADD COLUMN IF NOT EXISTS category VARCHAR(50),
    ADD COLUMN IF NOT EXISTS label VARCHAR(255),
    ADD COLUMN IF NOT EXISTS fill_mode VARCHAR(20),
    ADD COLUMN IF NOT EXISTS manual_value TEXT,
    ADD COLUMN IF NOT EXISTS instruction TEXT,
    ADD COLUMN IF NOT EXISTS source_document_id UUID,
    ADD COLUMN IF NOT EXISTS source_drive_file_id VARCHAR(255),
    ADD COLUMN IF NOT EXISTS source_drive_file_name VARCHAR(255),
    ADD COLUMN IF NOT EXISTS last_result TEXT,
    ADD COLUMN IF NOT EXISTS page_reference TEXT,
    ADD COLUMN IF NOT EXISTS last_result_metadata JSONB,
    ADD COLUMN IF NOT EXISTS status VARCHAR(30),
    ADD COLUMN IF NOT EXISTS last_executed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS source_file_modified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS created_by UUID;

-- Garante que page_reference utilize o tipo TEXT, evitando erros de truncamento em VARCHAR(255)
ALTER TABLE public.auditoria_memorias
    ALTER COLUMN page_reference TYPE TEXT;

-- ----------------------------------------------------------------------------
-- 3. EQUIVALÊNCIA E VALIDAÇÃO DE RESTRIÇÕES EM TABELAS PREEXISTENTES
-- ----------------------------------------------------------------------------

-- 3.1. Identificador Primário (id): DEFAULT gen_random_uuid(), NOT NULL e PRIMARY KEY especificamente em (id)
DO $$
DECLARE
    pk_cols text[];
    dup_id_count int;
BEGIN
    -- Assegura valor padrão UUIDv4
    ALTER TABLE public.auditoria_memorias 
        ALTER COLUMN id SET DEFAULT gen_random_uuid();

    -- Valida se há IDs nulos
    IF EXISTS (SELECT 1 FROM public.auditoria_memorias WHERE id IS NULL) THEN
        RAISE EXCEPTION 'Migração abortada: existem registros em public.auditoria_memorias com coluna "id" NULA.';
    END IF;

    ALTER TABLE public.auditoria_memorias 
        ALTER COLUMN id SET NOT NULL;

    -- Obter as colunas da chave primária existente (se houver)
    SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
    INTO pk_cols
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
    WHERE n.nspname = 'public' 
      AND t.relname = 'auditoria_memorias' 
      AND c.contype = 'p';

    IF pk_cols IS NOT NULL THEN
        -- Se existe uma PK na tabela, ela DEVE ser exatamente a coluna 'id'
        IF pk_cols <> ARRAY['id']::text[] THEN
            RAISE EXCEPTION 'Migração abortada: a tabela public.auditoria_memorias possui uma chave primária diferente da coluna "id" (colunas encontradas: %).', pk_cols;
        END IF;
    ELSE
        -- Nenhuma PK existe na tabela.
        -- Verifica se existem IDs duplicados antes de tentar aplicar a chave primária
        SELECT COUNT(*) INTO dup_id_count
        FROM (
            SELECT id
            FROM public.auditoria_memorias
            GROUP BY id
            HAVING COUNT(*) > 1
        ) dup;

        IF dup_id_count > 0 THEN
            RAISE EXCEPTION 'Migração abortada: existem % identificador(es) "id" duplicados em public.auditoria_memorias. Corrija as duplicidades antes de definir a chave primária.', dup_id_count;
        END IF;

        ALTER TABLE public.auditoria_memorias 
            ADD PRIMARY KEY (id);
    END IF;
END $$;

-- 3.2. Chave Estrangeira e Isolamento por Condomínio (condo_id)
-- Valida rigorosamente: detecta qualquer FK que envolva condo_id (inclusive chaves compostas),
-- aceita unicamente a FK canônica (tabela leads, coluna única condo_id, coluna remota id e confdeltype = 'c')
-- e aborta se encontrar FK composta ou divergente.
DO $$
DECLARE
    orphan_condos INT;
    fk_record RECORD;
    has_valid_fk BOOLEAN := false;
BEGIN
    -- Valida nulidade de condomínio
    IF EXISTS (SELECT 1 FROM public.auditoria_memorias WHERE condo_id IS NULL) THEN
        RAISE EXCEPTION 'Migração abortada: existem registros em public.auditoria_memorias com "condo_id" NULO.';
    END IF;

    -- Valida integridade referencial com public.leads(id)
    SELECT COUNT(*) INTO orphan_condos
    FROM public.auditoria_memorias m
    LEFT JOIN public.leads l ON l.id = m.condo_id
    WHERE l.id IS NULL;

    IF orphan_condos > 0 THEN
        RAISE EXCEPTION 'Migração abortada: existem % registro(s) em public.auditoria_memorias com condo_id inexistente na tabela public.leads.', orphan_condos;
    END IF;

    ALTER TABLE public.auditoria_memorias 
        ALTER COLUMN condo_id SET NOT NULL;

    -- Inspeciona TODAS as Foreign Keys que envolvam a coluna local 'condo_id' (simples ou compostas)
    FOR fk_record IN (
        SELECT 
            c.conname,
            c.confdeltype,
            fn.nspname AS ref_schema,
            ft.relname AS ref_table,
            (
                SELECT array_agg(a.attname::text ORDER BY array_position(c.conkey, a.attnum))
                FROM pg_attribute a
                WHERE a.attrelid = t.oid AND a.attnum = ANY(c.conkey)
            ) AS local_cols,
            (
                SELECT array_agg(fa.attname::text ORDER BY array_position(c.confkey, fa.attnum))
                FROM pg_attribute fa
                WHERE fa.attrelid = c.confrelid AND fa.attnum = ANY(c.confkey)
            ) AS ref_cols
        FROM pg_constraint c
        JOIN pg_class t ON c.conrelid = t.oid
        JOIN pg_namespace n ON t.relnamespace = n.oid
        JOIN pg_class ft ON c.confrelid = ft.oid
        JOIN pg_namespace fn ON ft.relnamespace = fn.oid
        WHERE n.nspname = 'public'
          AND t.relname = 'auditoria_memorias'
          AND c.contype = 'f'
          AND EXISTS (
              SELECT 1 
              FROM pg_attribute a
              WHERE a.attrelid = t.oid 
                AND a.attname = 'condo_id' 
                AND a.attnum = ANY(c.conkey)
          )
    ) LOOP
        -- Verifica se atende rigorosamente a todos os critérios da FK canônica:
        -- 1. Schema referenciado = 'public' e tabela referenciada = 'leads'
        -- 2. Coluna local é EXATAMENTE ARRAY['condo_id'] (não composta)
        -- 3. Coluna referenciada é EXATAMENTE ARRAY['id'] (não composta)
        -- 4. Ação em DELETE = CASCADE ('c')
        IF fk_record.ref_schema = 'public' 
           AND fk_record.ref_table = 'leads'
           AND fk_record.local_cols = ARRAY['condo_id']::text[]
           AND fk_record.ref_cols = ARRAY['id']::text[]
           AND fk_record.confdeltype = 'c' THEN
            has_valid_fk := true;
        ELSE
            -- Se existe FK envolvendo condo_id porém composta ou incompatível, aborta com erro explícito
            RAISE EXCEPTION 'Migração abortada: a tabela public.auditoria_memorias possui uma Foreign Key incompatível ou composta envolvendo a coluna condo_id (constraint "%", colunas locais: %, referenciando %.%(%), confdeltype="%", esperado única em condo_id -> public.leads(id) ON DELETE CASCADE "c"). Corrija ou avalie antes de migrar.',
                fk_record.conname, fk_record.local_cols, fk_record.ref_schema, fk_record.ref_table, fk_record.ref_cols, fk_record.confdeltype;
        END IF;
    END LOOP;

    -- Se não existe nenhuma FK envolvendo a coluna condo_id, cria a FK canônica esperada
    IF NOT has_valid_fk THEN
        ALTER TABLE public.auditoria_memorias
            ADD CONSTRAINT fk_auditoria_memorias_condo
            FOREIGN KEY (condo_id) REFERENCES public.leads(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 3.3. Campos Obrigatórios de Identificação (category e label)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM public.auditoria_memorias WHERE category IS NULL OR length(trim(category)) = 0) THEN
        RAISE EXCEPTION 'Migração abortada: existem registros em public.auditoria_memorias com "category" NULA ou vazia.';
    END IF;
    ALTER TABLE public.auditoria_memorias ALTER COLUMN category SET NOT NULL;

    IF EXISTS (SELECT 1 FROM public.auditoria_memorias WHERE label IS NULL OR length(trim(label)) = 0) THEN
        RAISE EXCEPTION 'Migração abortada: existem registros em public.auditoria_memorias com "label" NULO ou vazio.';
    END IF;
    ALTER TABLE public.auditoria_memorias ALTER COLUMN label SET NOT NULL;
END $$;

-- 3.4. Modo de Preenchimento (fill_mode): NOT NULL, DEFAULT 'ai' e CHECK chk_auditoria_memorias_fill_mode ÚNICO
DO $$
DECLARE
    invalid_fill_mode_count INT;
BEGIN
    -- Preenchimento retroativo seguro apenas se a coluna era nula em registros legados
    UPDATE public.auditoria_memorias
    SET fill_mode = 'ai'
    WHERE fill_mode IS NULL;

    SELECT COUNT(*) INTO invalid_fill_mode_count
    FROM public.auditoria_memorias
    WHERE fill_mode NOT IN ('manual', 'ai');

    IF invalid_fill_mode_count > 0 THEN
        RAISE EXCEPTION 'Migração abortada: existem % registro(s) com "fill_mode" inválido (valores diferentes de "manual" e "ai").', invalid_fill_mode_count;
    END IF;

    ALTER TABLE public.auditoria_memorias ALTER COLUMN fill_mode SET DEFAULT 'ai';
    ALTER TABLE public.auditoria_memorias ALTER COLUMN fill_mode SET NOT NULL;

    -- Limpeza de constraint anônima legada caso preexista da criação inicial
    ALTER TABLE public.auditoria_memorias DROP CONSTRAINT IF EXISTS auditoria_memorias_fill_mode_check;
    ALTER TABLE public.auditoria_memorias DROP CONSTRAINT IF EXISTS chk_auditoria_memorias_fill_mode;

    -- Criação atômica da constraint única e nomeada
    ALTER TABLE public.auditoria_memorias
        ADD CONSTRAINT chk_auditoria_memorias_fill_mode
        CHECK (fill_mode IN ('manual', 'ai'));
END $$;

-- 3.5. Status da Memória (status): NOT NULL, DEFAULT 'never_searched' e CHECK chk_auditoria_memorias_status ÚNICO
DO $$
DECLARE
    invalid_status_count INT;
BEGIN
    -- Definição retroativa segura de status para registros com status nulo
    UPDATE public.auditoria_memorias
    SET status = CASE 
        WHEN fill_mode = 'manual' OR last_result IS NOT NULL THEN 'result_available'
        ELSE 'never_searched'
    END
    WHERE status IS NULL;

    SELECT COUNT(*) INTO invalid_status_count
    FROM public.auditoria_memorias
    WHERE status NOT IN ('never_searched', 'result_available', 'outdated', 'failed');

    IF invalid_status_count > 0 THEN
        RAISE EXCEPTION 'Migração abortada: existem % registro(s) com "status" inválido (diferente de never_searched, result_available, outdated, failed).', invalid_status_count;
    END IF;

    ALTER TABLE public.auditoria_memorias ALTER COLUMN status SET DEFAULT 'never_searched';
    ALTER TABLE public.auditoria_memorias ALTER COLUMN status SET NOT NULL;

    -- Limpeza de constraint anônima legada caso preexista da criação inicial
    ALTER TABLE public.auditoria_memorias DROP CONSTRAINT IF EXISTS auditoria_memorias_status_check;
    ALTER TABLE public.auditoria_memorias DROP CONSTRAINT IF EXISTS chk_auditoria_memorias_status;

    -- Criação atômica da constraint única e nomeada
    ALTER TABLE public.auditoria_memorias
        ADD CONSTRAINT chk_auditoria_memorias_status
        CHECK (status IN ('never_searched', 'result_available', 'outdated', 'failed'));
END $$;

-- 3.6. Timestamps de Auditoria (created_at e updated_at)
DO $$
BEGIN
    ALTER TABLE public.auditoria_memorias ALTER COLUMN created_at SET DEFAULT NOW();
    ALTER TABLE public.auditoria_memorias ALTER COLUMN updated_at SET DEFAULT NOW();

    UPDATE public.auditoria_memorias SET created_at = NOW() WHERE created_at IS NULL;
    UPDATE public.auditoria_memorias SET updated_at = NOW() WHERE updated_at IS NULL;

    ALTER TABLE public.auditoria_memorias ALTER COLUMN created_at SET NOT NULL;
    ALTER TABLE public.auditoria_memorias ALTER COLUMN updated_at SET NOT NULL;
END $$;

-- ----------------------------------------------------------------------------
-- 4. CONSTRAINT DE CONSISTÊNCIA ENTRE OS MODOS MANUAL E IA
-- ----------------------------------------------------------------------------
-- Valida os dados existentes e aborta a migração com erro explícito se houver contradição.
-- Regras estritas:
-- - Modo Manual: exige manual_value não vazio, PROÍBE instruction e PROÍBE source_drive_file_id.
-- - Modo IA: exige instruction não vazia, exige source_drive_file_id não vazio e PROÍBE manual_value.
DO $$
DECLARE
    inconsistent_manual_count INT;
    inconsistent_ai_count INT;
BEGIN
    SELECT COUNT(*) INTO inconsistent_manual_count
    FROM public.auditoria_memorias
    WHERE fill_mode = 'manual'
      AND (
          manual_value IS NULL 
          OR length(trim(manual_value)) = 0 
          OR instruction IS NOT NULL
          OR source_drive_file_id IS NOT NULL
      );

    IF inconsistent_manual_count > 0 THEN
        RAISE EXCEPTION 'Migração abortada: existem % registro(s) inconsistentes no modo manual (manual_value vazio/nulo ou contendo instruction/source_drive_file_id indevidos).', inconsistent_manual_count;
    END IF;

    SELECT COUNT(*) INTO inconsistent_ai_count
    FROM public.auditoria_memorias
    WHERE fill_mode = 'ai'
      AND (
          manual_value IS NOT NULL 
          OR instruction IS NULL 
          OR length(trim(instruction)) = 0
          OR source_drive_file_id IS NULL
          OR length(trim(source_drive_file_id)) = 0
      );

    IF inconsistent_ai_count > 0 THEN
        RAISE EXCEPTION 'Migração abortada: existem % registro(s) inconsistentes no modo IA (instruction/source_drive_file_id ausentes ou vazios, ou contendo manual_value indevido).', inconsistent_ai_count;
    END IF;

    -- Remove constraint anterior (se existir) e recria a versão rigorosamente validada
    ALTER TABLE public.auditoria_memorias DROP CONSTRAINT IF EXISTS chk_auditoria_memoria_consistency;

    ALTER TABLE public.auditoria_memorias
        ADD CONSTRAINT chk_auditoria_memoria_consistency CHECK (
            (
                fill_mode = 'manual' 
                AND manual_value IS NOT NULL 
                AND length(trim(manual_value)) > 0
                AND instruction IS NULL
                AND source_drive_file_id IS NULL
            )
            OR
            (
                fill_mode = 'ai' 
                AND manual_value IS NULL
                AND instruction IS NOT NULL 
                AND length(trim(instruction)) > 0
                AND source_drive_file_id IS NOT NULL 
                AND length(trim(source_drive_file_id)) > 0
            )
        );
END $$;

-- ----------------------------------------------------------------------------
-- 5. ÍNDICES DE DESEMPENHO E CONSULTA
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_auditoria_memorias_condo_cat 
    ON public.auditoria_memorias (condo_id, category);

CREATE INDEX IF NOT EXISTS idx_auditoria_memorias_condo 
    ON public.auditoria_memorias (condo_id);

CREATE INDEX IF NOT EXISTS idx_auditoria_memorias_drive_file 
    ON public.auditoria_memorias (source_drive_file_id) 
    WHERE source_drive_file_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_auditoria_memorias_fill_mode 
    ON public.auditoria_memorias (condo_id, category, fill_mode);

-- ----------------------------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) COM FUNÇÕES CANÔNICAS DO TRIVERUS
-- ----------------------------------------------------------------------------
ALTER TABLE public.auditoria_memorias ENABLE ROW LEVEL SECURITY;

-- Limpeza determinística de políticas prévias na tabela
DROP POLICY IF EXISTS "auditoria_memorias_select" ON public.auditoria_memorias;
DROP POLICY IF EXISTS "auditoria_memorias_all" ON public.auditoria_memorias;
DROP POLICY IF EXISTS "auditoria_memorias_select_policy" ON public.auditoria_memorias;
DROP POLICY IF EXISTS "auditoria_memorias_insert_policy" ON public.auditoria_memorias;
DROP POLICY IF EXISTS "auditoria_memorias_update_policy" ON public.auditoria_memorias;
DROP POLICY IF EXISTS "auditoria_memorias_delete_policy" ON public.auditoria_memorias;

-- 6.1. Leitura: Usuários com acesso concedido ao condomínio (can_access_auditoria, can_manage_auditoria ou admin)
CREATE POLICY "auditoria_memorias_select_policy"
    ON public.auditoria_memorias
    FOR SELECT
    TO authenticated
    USING (public.can_user_access_condo(condo_id));

-- 6.2. Inserção: Usuários com permissão de gerenciamento da auditoria no condomínio (can_manage_auditoria ou admin)
CREATE POLICY "auditoria_memorias_insert_policy"
    ON public.auditoria_memorias
    FOR INSERT
    TO authenticated
    WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

-- 6.3. Atualização: Usuários com permissão de gerenciamento da auditoria no condomínio
CREATE POLICY "auditoria_memorias_update_policy"
    ON public.auditoria_memorias
    FOR UPDATE
    TO authenticated
    USING (public.can_user_manage_condo_auditoria(condo_id))
    WITH CHECK (public.can_user_manage_condo_auditoria(condo_id));

-- 6.4. Exclusão: Usuários com permissão de gerenciamento da auditoria no condomínio
CREATE POLICY "auditoria_memorias_delete_policy"
    ON public.auditoria_memorias
    FOR DELETE
    TO authenticated
    USING (public.can_user_manage_condo_auditoria(condo_id));

-- ----------------------------------------------------------------------------
-- 7. GRANTS E REVOGAÇÕES DE PRIVILÉGIOS
-- ----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auditoria_memorias TO authenticated;
GRANT ALL ON public.auditoria_memorias TO service_role;
REVOKE ALL ON public.auditoria_memorias FROM anon, public;

COMMIT;
