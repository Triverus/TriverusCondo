-- Migration: add_next_follow_up_at_and_google_event_id
-- Descrição: Adiciona colunas para armazenamento oficial de data + horário do follow-up e identificador do Google Calendar em public.interactions.
-- Mantém a coluna legado next_follow_up_date intacta para compatibilidade e transição sem quebras.

-- 1. Coluna oficial de data e horário do próximo follow-up em timestamptz (fuso horário com offset)
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS next_follow_up_at timestamptz NULL;

-- 2. Coluna para futuro armazenamento do ID do evento retornado pela Google Calendar API
ALTER TABLE public.interactions
  ADD COLUMN IF NOT EXISTS google_event_id text NULL;

-- 3. Comentários documentais nas colunas
COMMENT ON COLUMN public.interactions.next_follow_up_at IS 'Data e horário oficial do próximo compromisso/follow-up em timestamptz (com fuso horário explícito America/Sao_Paulo).';
COMMENT ON COLUMN public.interactions.google_event_id IS 'ID único do evento correspondente no Google Calendar API para sincronização, atualização e cancelamento futuros.';
