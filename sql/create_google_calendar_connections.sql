-- Script DDL: public.google_calendar_connections
-- Para execução no Supabase SQL Editor ou migração manual
-- Segurança: Tokens sensíveis (access_token, refresh_token) acessíveis exclusivamente pelo backend server-side.
-- RLS habilitado sem policies para authenticated/anon (Default Deny total para clientes frontend).

-- 1. Criação da tabela public.google_calendar_connections
CREATE TABLE IF NOT EXISTS public.google_calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  google_email text NULL,
  access_token text NOT NULL,
  refresh_token text NULL,
  token_type text NULL,
  scope text NULL,
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT google_calendar_connections_user_id_key UNIQUE (user_id)
);

-- 2. Habilitação de RLS (Row Level Security)
-- RLS ativado SEM policies para 'authenticated' ou 'anon'.
-- Isso assegura Default Deny no client SDK: usuários normais não têm permissão de SELECT, INSERT, UPDATE ou DELETE.
ALTER TABLE public.google_calendar_connections ENABLE ROW LEVEL SECURITY;

-- 3. Função e trigger para manter updated_at sempre atualizado automaticamente
CREATE OR REPLACE FUNCTION public.handle_google_calendar_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_google_calendar_connections_updated_at ON public.google_calendar_connections;
CREATE TRIGGER trg_google_calendar_connections_updated_at
  BEFORE UPDATE ON public.google_calendar_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_google_calendar_connections_updated_at();

-- 4. Comentários explicativos da tabela e colunas
COMMENT ON TABLE public.google_calendar_connections IS 'Armazena credenciais OAuth2 do Google Calendar vinculadas a usuários do Supabase. Acesso restrito exclusivamente ao backend.';
COMMENT ON COLUMN public.google_calendar_connections.user_id IS 'Referência ao usuário auth.users(id), restrito a no máximo uma conexão única por usuário';
COMMENT ON COLUMN public.google_calendar_connections.access_token IS 'Token de acesso para chamadas à API do Google Calendar';
COMMENT ON COLUMN public.google_calendar_connections.refresh_token IS 'Token de atualização para renovação de access_token offline';
