-- ==============================================================================
-- TRIVERUS CRM — CONSULTAS DE DIAGNÓSTICO DE INTEGRIDADE REFERENCIAL & USUÁRIOS
-- Execute este script no SQL Editor do Supabase para auditar as restrições reais.
-- ==============================================================================

-- 1. IDENTIFICAR TODAS AS FOREIGN KEYS ENVOLVENDO auth.users E public.profiles
SELECT 
    tc.table_schema, 
    tc.table_name, 
    kcu.column_name, 
    ccu.table_schema AS foreign_table_schema,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name,
    rc.delete_rule,
    rc.update_rule,
    tc.constraint_name
FROM information_schema.table_constraints AS tc 
JOIN information_schema.key_column_usage AS kcu
  ON tc.constraint_name = kcu.constraint_name
  AND tc.table_schema = kcu.table_schema
JOIN information_schema.referential_constraints AS rc
  ON tc.constraint_name = rc.constraint_name
JOIN information_schema.constraint_column_usage AS ccu
  ON rc.unique_constraint_name = ccu.constraint_name
WHERE (tc.table_schema = 'public' OR ccu.table_schema = 'auth')
  AND (tc.table_name IN ('profiles', 'interactions', 'leads', 'stage_history', 'user_permissions', 'google_calendar_connections', 'contacts', 'lead_contacts', 'lead_services')
       OR ccu.table_name IN ('users', 'profiles'))
ORDER BY tc.table_name, kcu.column_name;

-- 2. VERIFICAR A PRESENÇA DA COLUNA deleted_at EM public.profiles
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
  AND table_name = 'profiles'
  AND column_name = 'deleted_at';

-- 3. AUDITAR POLÍTICAS RLS ATIVAS NAS TABELAS DO CRM
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'interactions', 'leads', 'stage_history', 'user_permissions', 'google_calendar_connections')
ORDER BY tablename, policyname;

-- 4. AUDITAR GATILHOS (TRIGGERS) ATIVOS
SELECT 
    event_object_table AS table_name,
    trigger_name,
    event_manipulation AS event,
    action_statement AS action,
    action_timing AS timing
FROM information_schema.triggers
WHERE trigger_schema = 'public'
  AND event_object_table IN ('profiles', 'interactions', 'leads')
ORDER BY event_object_table, trigger_name;

-- 5. LISTAR ADMINISTRADORES ATIVOS ATUAIS
SELECT id, full_name, email, role, is_active
FROM public.profiles
WHERE (role = 'admin' OR role = 'administrador')
  AND is_active = true;
