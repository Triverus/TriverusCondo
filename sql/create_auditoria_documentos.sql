-- ==============================================================================
-- MIGRATION: public.auditoria_documentos (Idempotente, Não-Destrutiva e Segura)
-- Projeto: Triverus CRM — Auditoria de Condomínios
-- Atomicidade: Executada integralmente dentro de transação BEGIN ... COMMIT.
-- ==============================================================================

BEGIN;

-- 1. Criação da tabela base (se ainda não existir)
CREATE TABLE IF NOT EXISTS public.auditoria_documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  condo_id uuid NOT NULL,
  category text NOT NULL,
  drive_file_id text NOT NULL,
  drive_file_name text NOT NULL,
  drive_file_size bigint NULL,
  drive_file_modified_at timestamptz NULL,
  linked_by_user_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Validação da estrutura preexistente (colunas, tipos, chaves, defaults e nulabilidade)
DO $$
DECLARE
  v_row_count bigint;
  v_col_type text;
  v_is_nullable text;
  v_col_default text;
  v_null_count bigint;
  v_pk_name text;
  v_pk_col_count bigint;
  v_pk_is_only_id boolean;
  v_dup_count bigint;
BEGIN
  -- Quantidade de registros preexistentes na tabela
  SELECT count(*) INTO v_row_count FROM public.auditoria_documentos;

  -- 2.1. id (uuid, chave primária e DEFAULT gen_random_uuid())
  SELECT udt_name, is_nullable, column_default INTO v_col_type, v_is_nullable, v_col_default
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'id';

  IF v_col_type IS NULL THEN
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: a coluna id está ausente e a tabela contém % registros existentes. Não é permitido gerar IDs artificiais para registros históricos sem decisão manual.', v_row_count;
    ELSE
      ALTER TABLE public.auditoria_documentos ADD COLUMN id uuid PRIMARY KEY DEFAULT gen_random_uuid();
    END IF;
  ELSIF v_col_type <> 'uuid' THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna id em public.auditoria_documentos possui tipo incompatível (%). Esperado: uuid.', v_col_type;
  ELSE
    -- Garantir o default gen_random_uuid() para novas inserções sem alterar registros existentes
    ALTER TABLE public.auditoria_documentos ALTER COLUMN id SET DEFAULT gen_random_uuid();

    -- Verificar constraint de chave primária existente especificamente em public.auditoria_documentos via pg_catalog
    SELECT c.conname,
           cardinality(c.conkey)::bigint,
           bool_and(a.attname = 'id')
    INTO v_pk_name, v_pk_col_count, v_pk_is_only_id
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
    WHERE c.conrelid = 'public.auditoria_documentos'::regclass
      AND c.contype = 'p'
    GROUP BY c.conname, c.conkey;

    IF v_pk_name IS NOT NULL THEN
      -- Se a PK existir mas não for composta exclusivamente pela coluna id: abortar
      IF v_pk_col_count <> 1 OR NOT v_pk_is_only_id THEN
        RAISE EXCEPTION 'Migração interrompida: a tabela public.auditoria_documentos possui uma chave primária existente (%) incompatível, que não é composta exclusivamente pela coluna id. A constraint não foi alterada automaticamente para preservar a integridade dos dados. Realize a revisão manual.', v_pk_name;
      END IF;
    ELSE
      -- Nenhuma chave primária existe na tabela: validar dados antes de criá-la
      SELECT count(*) INTO v_null_count FROM public.auditoria_documentos WHERE id IS NULL;
      IF v_null_count > 0 THEN
        RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com id NULL em public.auditoria_documentos. Regularize esses dados manualmente antes de criar a chave primária.', v_null_count;
      END IF;

      -- Validar se há valores duplicados em id antes de definir chave primária
      SELECT count(*) INTO v_dup_count FROM (
        SELECT id FROM public.auditoria_documentos GROUP BY id HAVING count(*) > 1
      ) dup_ids;
      IF v_dup_count > 0 THEN
        RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com identificadores duplicados na coluna id em public.auditoria_documentos. Resolva as duplicidades manualmente antes de criar a chave primária.', v_dup_count;
      END IF;

      -- Adicionar constraint de chave primária com NOT NULL
      ALTER TABLE public.auditoria_documentos ALTER COLUMN id SET NOT NULL;
      ALTER TABLE public.auditoria_documentos ADD CONSTRAINT pk_auditoria_documentos PRIMARY KEY (id);
    END IF;
  END IF;

  -- 2.2. condo_id (uuid, NOT NULL)
  SELECT udt_name, is_nullable INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'condo_id';

  IF v_col_type IS NULL THEN
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: a coluna condo_id está ausente e a tabela contém % registros existentes. Não é seguro inventar condo_id para registros existentes.', v_row_count;
    ELSE
      ALTER TABLE public.auditoria_documentos ADD COLUMN condo_id uuid NOT NULL;
    END IF;
  ELSIF v_col_type <> 'uuid' THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna condo_id possui tipo incompatível (%). Esperado: uuid.', v_col_type;
  ELSE
    SELECT count(*) INTO v_null_count FROM public.auditoria_documentos WHERE condo_id IS NULL;
    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com condo_id NULL em public.auditoria_documentos. Regularize esses dados antes de aplicar a restrição NOT NULL.', v_null_count;
    ELSIF v_is_nullable = 'YES' THEN
      ALTER TABLE public.auditoria_documentos ALTER COLUMN condo_id SET NOT NULL;
    END IF;
  END IF;

  -- 2.3. category (text/varchar, NOT NULL)
  SELECT udt_name, is_nullable INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'category';

  IF v_col_type IS NULL THEN
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: a coluna category está ausente e a tabela contém % registros. Não é seguro inventar category para registros existentes.', v_row_count;
    ELSE
      ALTER TABLE public.auditoria_documentos ADD COLUMN category text NOT NULL;
    END IF;
  ELSIF v_col_type NOT IN ('text', 'varchar', 'bpchar') THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna category possui tipo incompatível (%). Esperado: text ou varchar.', v_col_type;
  ELSE
    SELECT count(*) INTO v_null_count FROM public.auditoria_documentos WHERE category IS NULL;
    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com category NULL em public.auditoria_documentos.', v_null_count;
    ELSIF v_is_nullable = 'YES' THEN
      ALTER TABLE public.auditoria_documentos ALTER COLUMN category SET NOT NULL;
    END IF;
  END IF;

  -- 2.4. drive_file_id (text/varchar, NOT NULL)
  SELECT udt_name, is_nullable INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'drive_file_id';

  IF v_col_type IS NULL THEN
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: a coluna drive_file_id está ausente e a tabela contém % registros. Não é seguro inventar drive_file_id.', v_row_count;
    ELSE
      ALTER TABLE public.auditoria_documentos ADD COLUMN drive_file_id text NOT NULL;
    END IF;
  ELSIF v_col_type NOT IN ('text', 'varchar', 'bpchar') THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna drive_file_id possui tipo incompatível (%). Esperado: text ou varchar.', v_col_type;
  ELSE
    SELECT count(*) INTO v_null_count FROM public.auditoria_documentos WHERE drive_file_id IS NULL;
    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com drive_file_id NULL em public.auditoria_documentos.', v_null_count;
    ELSIF v_is_nullable = 'YES' THEN
      ALTER TABLE public.auditoria_documentos ALTER COLUMN drive_file_id SET NOT NULL;
    END IF;
  END IF;

  -- 2.5. drive_file_name (text/varchar, NOT NULL)
  SELECT udt_name, is_nullable INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'drive_file_name';

  IF v_col_type IS NULL THEN
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: a coluna drive_file_name está ausente e a tabela contém % registros. Não é seguro inventar drive_file_name.', v_row_count;
    ELSE
      ALTER TABLE public.auditoria_documentos ADD COLUMN drive_file_name text NOT NULL;
    END IF;
  ELSIF v_col_type NOT IN ('text', 'varchar', 'bpchar') THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna drive_file_name possui tipo incompatível (%). Esperado: text ou varchar.', v_col_type;
  ELSE
    SELECT count(*) INTO v_null_count FROM public.auditoria_documentos WHERE drive_file_name IS NULL;
    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com drive_file_name NULL em public.auditoria_documentos.', v_null_count;
    ELSIF v_is_nullable = 'YES' THEN
      ALTER TABLE public.auditoria_documentos ALTER COLUMN drive_file_name SET NOT NULL;
    END IF;
  END IF;

  -- 2.6. drive_file_size (bigint/integer/numeric, NULL)
  SELECT udt_name INTO v_col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'drive_file_size';

  IF v_col_type IS NULL THEN
    ALTER TABLE public.auditoria_documentos ADD COLUMN drive_file_size bigint NULL;
  ELSIF v_col_type NOT IN ('int8', 'int4', 'numeric') THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna drive_file_size possui tipo incompatível (%). Esperado: bigint/int8 ou numeric.', v_col_type;
  END IF;

  -- 2.7. drive_file_modified_at (timestamptz/timestamp, NULL)
  SELECT udt_name INTO v_col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'drive_file_modified_at';

  IF v_col_type IS NULL THEN
    ALTER TABLE public.auditoria_documentos ADD COLUMN drive_file_modified_at timestamptz NULL;
  ELSIF v_col_type NOT IN ('timestamptz', 'timestamp') THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna drive_file_modified_at possui tipo incompatível (%). Esperado: timestamptz ou timestamp.', v_col_type;
  END IF;

  -- 2.8. linked_by_user_id (uuid, NULL)
  SELECT udt_name INTO v_col_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'linked_by_user_id';

  IF v_col_type IS NULL THEN
    ALTER TABLE public.auditoria_documentos ADD COLUMN linked_by_user_id uuid NULL;
  ELSIF v_col_type <> 'uuid' THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna linked_by_user_id possui tipo incompatível (%). Esperado: uuid.', v_col_type;
  END IF;

  -- 2.9. created_at (timestamptz/timestamp, NOT NULL DEFAULT now())
  SELECT udt_name, is_nullable INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'created_at';

  IF v_col_type IS NULL THEN
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: a coluna created_at está ausente e a tabela contém % registros existentes. Não é permitido gerar datas artificiais para registros históricos sem decisão manual.', v_row_count;
    ELSE
      ALTER TABLE public.auditoria_documentos ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
    END IF;
  ELSIF v_col_type NOT IN ('timestamptz', 'timestamp') THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna created_at possui tipo incompatível (%). Esperado: timestamptz ou timestamp.', v_col_type;
  ELSE
    -- Validar se há datas nulas existentes em vez de inventar valores
    SELECT count(*) INTO v_null_count FROM public.auditoria_documentos WHERE created_at IS NULL;
    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com created_at NULL em public.auditoria_documentos. Nenhum dado foi alterado silenciosamente. Defina as datas manualmente antes de aplicar a restrição NOT NULL.', v_null_count;
    END IF;

    -- Garantir o default now() para novas inserções sem alterar registros existentes
    ALTER TABLE public.auditoria_documentos ALTER COLUMN created_at SET DEFAULT now();

    IF v_is_nullable = 'YES' THEN
      ALTER TABLE public.auditoria_documentos ALTER COLUMN created_at SET NOT NULL;
    END IF;
  END IF;

  -- 2.10. updated_at (timestamptz/timestamp, NOT NULL DEFAULT now())
  SELECT udt_name, is_nullable INTO v_col_type, v_is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'auditoria_documentos' AND column_name = 'updated_at';

  IF v_col_type IS NULL THEN
    IF v_row_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: a coluna updated_at está ausente e a tabela contém % registros existentes. Não é permitido gerar datas artificiais para registros históricos sem decisão manual.', v_row_count;
    ELSE
      ALTER TABLE public.auditoria_documentos ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
    END IF;
  ELSIF v_col_type NOT IN ('timestamptz', 'timestamp') THEN
    RAISE EXCEPTION 'Migração interrompida: a coluna updated_at possui tipo incompatível (%). Esperado: timestamptz ou timestamp.', v_col_type;
  ELSE
    -- Validar se há datas nulas existentes em vez de inventar valores
    SELECT count(*) INTO v_null_count FROM public.auditoria_documentos WHERE updated_at IS NULL;
    IF v_null_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros com updated_at NULL em public.auditoria_documentos. Nenhum dado foi alterado silenciosamente. Defina as datas manualmente antes de aplicar a restrição NOT NULL.', v_null_count;
    END IF;

    -- Garantir o default now() para novas inserções sem alterar registros existentes
    ALTER TABLE public.auditoria_documentos ALTER COLUMN updated_at SET DEFAULT now();

    IF v_is_nullable = 'YES' THEN
      ALTER TABLE public.auditoria_documentos ALTER COLUMN updated_at SET NOT NULL;
    END IF;
  END IF;
END;
$$;

-- 3. Validação e aplicação estrita das Chaves Estrangeiras (FKs) via pg_catalog
DO $$
DECLARE
  v_rec RECORD;
  v_has_correct_fk_condo boolean := false;
  v_has_correct_fk_user boolean := false;
  v_orphan_count bigint;
BEGIN
  -- ----------------------------------------------------------------------------
  -- 3.1. Foreign key em condo_id -> public.leads(id) ON DELETE CASCADE
  -- Relação inequívoca: 1 coluna local (condo_id) para 1 coluna remota (id)
  -- ----------------------------------------------------------------------------
  FOR v_rec IN (
    SELECT c.conname AS constraint_name,
           c.confrelid AS ref_table_oid,
           cardinality(c.conkey) AS local_col_count,
           cardinality(c.confkey) AS ref_col_count,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS local_col,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) AS ref_col,
           c.confdeltype AS delete_rule
    FROM pg_constraint c
    WHERE c.conrelid = 'public.auditoria_documentos'::regclass
      AND c.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND a.attname = 'condo_id'
      )
  ) LOOP
    IF v_rec.local_col_count = 1
       AND v_rec.ref_col_count = 1
       AND v_rec.local_col = 'condo_id'
       AND v_rec.ref_table_oid = 'public.leads'::regclass
       AND v_rec.ref_col = 'id'
       AND v_rec.delete_rule = 'c' THEN
      v_has_correct_fk_condo := true;
    ELSE
      -- Constraint incorreta em condo_id: remover exclusivamente essa constraint, preservando registros
      EXECUTE format('ALTER TABLE public.auditoria_documentos DROP CONSTRAINT %I;', v_rec.constraint_name);
    END IF;
  END LOOP;

  -- Se a FK correta ainda não existir, validar integridade referencial antes de aplicá-la
  IF NOT v_has_correct_fk_condo THEN
    SELECT count(*) INTO v_orphan_count
    FROM public.auditoria_documentos ad
    WHERE NOT EXISTS (
      SELECT 1 FROM public.leads l WHERE l.id = ad.condo_id
    );

    IF v_orphan_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros em public.auditoria_documentos com condo_id que não existem em public.leads. Nenhum dado foi apagado ou alterado. Regularize os registros antes de aplicar a foreign key.', v_orphan_count;
    END IF;

    ALTER TABLE public.auditoria_documentos
      ADD CONSTRAINT fk_auditoria_documentos_condo
      FOREIGN KEY (condo_id) REFERENCES public.leads(id) ON DELETE CASCADE;
  END IF;

  -- ----------------------------------------------------------------------------
  -- 3.2. Foreign key em linked_by_user_id -> public.profiles(id) ON DELETE SET NULL
  -- Relação inequívoca: 1 coluna local (linked_by_user_id) para 1 coluna remota (id)
  -- ----------------------------------------------------------------------------
  FOR v_rec IN (
    SELECT c.conname AS constraint_name,
           c.confrelid AS ref_table_oid,
           cardinality(c.conkey) AS local_col_count,
           cardinality(c.confkey) AS ref_col_count,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS local_col,
           (SELECT a.attname FROM pg_attribute a WHERE a.attrelid = c.confrelid AND a.attnum = c.confkey[1]) AS ref_col,
           c.confdeltype AS delete_rule
    FROM pg_constraint c
    WHERE c.conrelid = 'public.auditoria_documentos'::regclass
      AND c.contype = 'f'
      AND EXISTS (
        SELECT 1 FROM pg_attribute a
        WHERE a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) AND a.attname = 'linked_by_user_id'
      )
  ) LOOP
    IF v_rec.local_col_count = 1
       AND v_rec.ref_col_count = 1
       AND v_rec.local_col = 'linked_by_user_id'
       AND v_rec.ref_table_oid = 'public.profiles'::regclass
       AND v_rec.ref_col = 'id'
       AND v_rec.delete_rule = 'n' THEN
      v_has_correct_fk_user := true;
    ELSE
      -- Constraint incorreta (ex: apontava para auth.users ou com delete_rule diferente de SET NULL): remover exclusivamente ela
      EXECUTE format('ALTER TABLE public.auditoria_documentos DROP CONSTRAINT %I;', v_rec.constraint_name);
    END IF;
  END LOOP;

  -- Se a FK correta ainda não existir, validar integridade referencial antes de aplicá-la
  IF NOT v_has_correct_fk_user THEN
    SELECT count(*) INTO v_orphan_count
    FROM public.auditoria_documentos ad
    WHERE ad.linked_by_user_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE p.id = ad.linked_by_user_id
      );

    IF v_orphan_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % registros em public.auditoria_documentos com linked_by_user_id que não existem em public.profiles. Nenhum dado foi apagado ou alterado. Regularize os perfis de usuário antes de aplicar a foreign key.', v_orphan_count;
    END IF;

    ALTER TABLE public.auditoria_documentos
      ADD CONSTRAINT fk_auditoria_documentos_linked_by_user
      FOREIGN KEY (linked_by_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- 4. Validação e aplicação estrita da restrição UNIQUE especificamente sobre (condo_id, category) via pg_catalog
DO $$
DECLARE
  v_unique_name text;
  v_dup_count bigint;
BEGIN
  -- Confirmação inequívoca via pg_catalog: existe restrição UNIQUE em public.auditoria_documentos
  -- composta EXATAMENTE pelas duas colunas distintas (condo_id e category), em qualquer ordem?
  SELECT c.conname INTO v_unique_name
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.auditoria_documentos'::regclass
    AND c.contype = 'u'
  GROUP BY c.conname, c.conkey
  HAVING cardinality(c.conkey) = 2
     AND count(DISTINCT a.attname) = 2
     AND bool_or(a.attname = 'condo_id')
     AND bool_or(a.attname = 'category');

  IF v_unique_name IS NULL THEN
    -- Antes de criar a constraint, verificar se há dados duplicados incompatíveis
    SELECT count(*) INTO v_dup_count
    FROM (
      SELECT condo_id, category
      FROM public.auditoria_documentos
      GROUP BY condo_id, category
      HAVING count(*) > 1
    ) dups;

    IF v_dup_count > 0 THEN
      RAISE EXCEPTION 'Migração interrompida: foram encontrados % pares duplicados para a combinação (condo_id, category) em public.auditoria_documentos. Nenhum registro foi apagado ou alterado. Resolva as duplicidades manualmente antes de aplicar a restrição UNIQUE.', v_dup_count;
    END IF;

    ALTER TABLE public.auditoria_documentos
      ADD CONSTRAINT uq_auditoria_documentos_condo_category UNIQUE (condo_id, category);
  END IF;
END;
$$;


-- 5. Índices de consulta otimizados
CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_condo ON public.auditoria_documentos(condo_id);
CREATE INDEX IF NOT EXISTS idx_auditoria_documentos_category ON public.auditoria_documentos(category);

-- 6. Habilitação de RLS (Row Level Security)
ALTER TABLE public.auditoria_documentos ENABLE ROW LEVEL SECURITY;

-- 7. Limpeza determinística de TODAS as políticas anteriores (varredura dinâmica canônica Triverus)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'auditoria_documentos'
  ) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.auditoria_documentos;', r.policyname);
  END LOOP;
END;
$$;

-- 8. Aplicação das políticas RLS canônicas seguras

-- 8.1. LEITURA: Exclusiva para colaboradores ativos no CRM
CREATE POLICY "auditoria_documentos_select"
  ON public.auditoria_documentos
  FOR SELECT
  TO authenticated
  USING (public.is_active_user());

-- 8.2. INSERÇÃO: Colaboradores ativos com permissão de gestão de condomínios ou administradores
CREATE POLICY "auditoria_documentos_insert"
  ON public.auditoria_documentos
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_permission('can_manage_leads'));

-- 8.3. ATUALIZAÇÃO: Colaboradores ativos com permissão de gestão de condomínios ou administradores
CREATE POLICY "auditoria_documentos_update"
  ON public.auditoria_documentos
  FOR UPDATE
  TO authenticated
  USING (public.has_permission('can_manage_leads'))
  WITH CHECK (public.has_permission('can_manage_leads'));

-- 8.4. EXCLUSÃO / DESVINCULAÇÃO: Colaboradores autorizados a gerenciar condomínios ou administradores
CREATE POLICY "auditoria_documentos_delete"
  ON public.auditoria_documentos
  FOR DELETE
  TO authenticated
  USING (public.has_permission('can_manage_leads'));

-- 9. Trigger e Função para manter updated_at automático
CREATE OR REPLACE FUNCTION public.handle_auditoria_documentos_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_auditoria_documentos_updated_at ON public.auditoria_documentos;
CREATE TRIGGER trg_auditoria_documentos_updated_at
  BEFORE UPDATE ON public.auditoria_documentos
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_auditoria_documentos_updated_at();

-- 10. Concessão de permissões de tabela para o PostgREST / Supabase API
GRANT SELECT, INSERT, UPDATE, DELETE ON public.auditoria_documentos TO authenticated, service_role;

-- 11. Documentação das colunas
COMMENT ON TABLE public.auditoria_documentos IS 'Armazena os vínculos oficiais de documentos da Auditoria Triverus com o Google Drive central.';
COMMENT ON COLUMN public.auditoria_documentos.condo_id IS 'Referência ao condomínio em public.leads(id)';
COMMENT ON COLUMN public.auditoria_documentos.category IS 'Categoria documental do condomínio (ex: convencao)';
COMMENT ON COLUMN public.auditoria_documentos.drive_file_id IS 'ID oficial e imutável do arquivo no Google Drive central';
COMMENT ON COLUMN public.auditoria_documentos.drive_file_name IS 'Nome do arquivo PDF no Google Drive no momento do vínculo';
COMMENT ON COLUMN public.auditoria_documentos.drive_file_size IS 'Tamanho em bytes do arquivo PDF';
COMMENT ON COLUMN public.auditoria_documentos.drive_file_modified_at IS 'Data de modificação do arquivo no Google Drive';
COMMENT ON COLUMN public.auditoria_documentos.linked_by_user_id IS 'Usuário do CRM (public.profiles.id) que realizou o vínculo';

COMMIT;

