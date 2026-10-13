import type { Contact } from './crmStore.tsx';

export interface ContactFormState {
  id?: string | null;
  name: string;
  roleTitle: string; // Ex: 'Síndico', 'Subsíndico', 'Conselheiro', 'Outro'
  customRoleTitle?: string;
  phone: string;
  email: string;
}

export const PRESET_ROLES = [
  'Síndico',
  'Subsíndico',
  'Conselheiro',
  'Representante da administradora',
  'Gerente Predial',
  'Outro',
] as const;

/**
 * Normaliza telefone para comparação estrita (apenas dígitos).
 * Se possuir DDI 55 com 12 ou 13 dígitos, remove o 55 para comparar DDD + número completo.
 * Exige número completo (mínimo 10 dígitos) para match exato inequívoco.
 */
export function normalizePhoneFull(phone?: string | null): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Normaliza e-mail para comparação estrita (trim e lowercase).
 */
export function normalizeEmail(email?: string | null): string {
  if (!email) return '';
  return email.trim().toLowerCase();
}

/**
 * Aplica máscara brasileira a telefone (10 ou 11 dígitos).
 */
export function formatPhoneMask(val: string): string {
  const digits = val.replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return `(${digits}`;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Converte linha do banco (public.contacts) para o tipo Contact do frontend.
 * Coluna oficial no Supabase: role_title
 */
export function mapContactRowFromDb(row: any): Contact {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    role_title: row.role_title ?? null,
    phone: row.phone ?? null,
    email: row.email ?? null,
    created_at: row.created_at ?? undefined,
  };
}

/**
 * Monta payload estrito para o Supabase (public.contacts).
 * Garante que somente as colunas reais sejam enviadas:
 * - name (string)
 * - role_title (string | null) -> Vínculo / Cargo
 * - phone (string | null)
 * - email (string | null)
 */
export function buildContactDbPayload(state: ContactFormState): {
  name: string;
  role_title: string | null;
  phone: string | null;
  email: string | null;
} {
  const trimmedName = state.name.trim();
  const rawRole = state.roleTitle?.trim();
  const finalRole =
    rawRole === 'Outro'
      ? state.customRoleTitle?.trim() || null
      : rawRole || null;

  const phoneDigits = state.phone.replace(/\D/g, '');
  const finalPhone = phoneDigits ? formatPhoneMask(phoneDigits) : null;
  const finalEmail = normalizeEmail(state.email) || null;

  return {
    name: trimmedName,
    role_title: finalRole,
    phone: finalPhone,
    email: finalEmail,
  };
}

/**
 * Normaliza nome para comparação: trim, lowercase, remoção de acentos e espaços duplicados.
 */
export function normalizeContactName(name?: string | null): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Padroniza nome próprio garantindo inicial em maiúscula sem destruir grafias complexas.
 */
export function formatProperName(name?: string | null): string {
  if (!name || typeof name !== 'string') return '';
  const trimmed = name.trim();
  if (!trimmed) return '';
  const prepositions = new Set(['da', 'de', 'do', 'das', 'dos', 'e']);
  const words = trimmed.split(/\s+/);
  return words
    .map((word, index) => {
      if (!word) return '';
      const lower = word.toLowerCase();
      if (index > 0 && prepositions.has(lower)) {
        return lower;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Verifica se dois nomes de contato são compatíveis (para permitir reutilização de 'Bruna' com 'Bruna Silva' mas nunca transformar Bruna em Aldair).
 */
export function areContactNamesCompatible(nameA?: string | null, nameB?: string | null): boolean {
  const cleanA = normalizeContactName(nameA);
  const cleanB = normalizeContactName(nameB);
  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;

  // Se um forneceu apenas o primeiro nome e o outro nome completo iniciando igual (ex: "Bruna" e "Bruna Silva")
  const partsA = cleanA.split(' ');
  const partsB = cleanB.split(' ');
  if (partsA[0] === partsB[0] && partsA[0].length >= 3) {
    if (partsA.length === 1 || partsB.length === 1) {
      return true;
    }
  }
  return false;
}
