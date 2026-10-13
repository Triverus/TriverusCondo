import { supabase } from './supabase.ts';
import type { Contact } from './crmStore.tsx';
import {
  type ContactFormState,
  buildContactDbPayload,
  normalizePhoneFull,
  normalizeEmail,
  areContactNamesCompatible,
} from './contactAdapter.ts';
import { saveLeadPrimaryContactOverride } from './crmCache.ts';

export interface ResolveOrCreateContactParams {
  leadId: string;
  leadName?: string;
  contactState: ContactFormState;
  existingContacts?: Contact[];
  isPrimary?: boolean;
}

export type ContactSaveResult = {
  success: boolean;
  contact: Contact;
  reused: boolean;
  linkedToLead: boolean;
  error?: string;
};

/**
 * Função central para resolução ou criação de contato vinculado a um condomínio (lead).
 *
 * Regras oficiais:
 * 1. CONTATO ≠ CONDOMÍNIO: Um mesmo contact.id pode estar vinculado a múltiplos condomínios via public.lead_contacts.
 * 2. REUTILIZAÇÃO AUTOMÁTICA: Ocorre apenas quando o NOME for compatível E (mesmo telefone OU mesmo e-mail).
 * 3. NOME DIFERENTE (ex: Aldair com telefone de Bruna): NÃO reutiliza nem renomeia Bruna; cria NOVO contato para Aldair.
 * 4. NENHUM BLOQUEIO / MODAL: Telefone/e-mail repetido não é erro nem conflito; não exige confirmação.
 * 5. NÃO ATUALIZA EXISTENTE NA REUTILIZAÇÃO: Reutilização não é edição.
 * 6. NÃO DUPLICA: O par (lead_id, contact_id) nunca é duplicado em public.lead_contacts.
 * 7. NÃO APAGA VÍNCULOS: Nunca remove outros contatos ou vínculos de forma automática/profilática.
 */
export async function resolveOrCreateContact({
  leadId,
  leadName,
  contactState,
  existingContacts = [],
  isPrimary = true,
}: ResolveOrCreateContactParams): Promise<ContactSaveResult> {
  const trimmedName = contactState.name.trim();
  const normPhone = normalizePhoneFull(contactState.phone);
  const normEmail = normalizeEmail(contactState.email);

  // 1. EDIÇÃO EXPLÍCITA: Se o formulário já possui contactState.id (usuário abriu para editar este contato)
  if (contactState.id) {
    try {
      const payload = buildContactDbPayload(contactState);
      const { data: updated, error: updateErr } = await supabase
        .from('contacts')
        .update(payload)
        .eq('id', contactState.id)
        .select('id, name, role_title, phone, email, created_at')
        .single();

      if (updateErr) throw updateErr;

      // Garantir que o vínculo com este lead existe em lead_contacts (sem duplicar)
      await ensureLeadContactLink(leadId, contactState.id);

      if (isPrimary) {
        saveLeadPrimaryContactOverride(leadId, contactState.id);
      }

      return {
        success: true,
        contact: updated,
        reused: true,
        linkedToLead: true,
      };
    } catch (err: any) {
      console.error('Erro ao atualizar contato existente:', err);
      return {
        success: false,
        contact: {
          id: contactState.id,
          name: contactState.name,
          role_title: contactState.roleTitle,
          phone: contactState.phone,
          email: contactState.email,
        },
        reused: true,
        linkedToLead: false,
        error: err?.message || 'Falha ao atualizar contato.',
      };
    }
  }

  // 2. BUSCA DE IDENTIDADE REALMENTE COMPATÍVEL (MATCH CONSERVADOR)
  // Exige: NOME COMPATÍVEL E (mesmo telefone OU mesmo e-mail)
  let matchedContact: Contact | null = null;

  if (trimmedName && (normPhone || normEmail)) {
    // 2.1 Buscar na memória local
    const memoryMatch = existingContacts.find((c) => {
      const nameMatch = areContactNamesCompatible(c.name, trimmedName);
      if (!nameMatch) return false;

      const phoneMatch = Boolean(normPhone && normalizePhoneFull(c.phone) === normPhone);
      const emailMatch = Boolean(normEmail && normalizeEmail(c.email) === normEmail);
      return phoneMatch || emailMatch;
    });

    if (memoryMatch) {
      matchedContact = memoryMatch;
    }

    // 2.2 Se não encontrou na memória, consultar Supabase
    if (!matchedContact) {
      try {
        if (normPhone && normPhone.length >= 8) {
          const { data: phoneMatches } = await supabase
            .from('contacts')
            .select('id, name, role_title, phone, email, created_at')
            .not('phone', 'is', null);

          if (phoneMatches && phoneMatches.length > 0) {
            const found = phoneMatches.find(
              (c) =>
                areContactNamesCompatible(c.name, trimmedName) &&
                normalizePhoneFull(c.phone) === normPhone
            );
            if (found) matchedContact = found;
          }
        }

        if (!matchedContact && normEmail) {
          const { data: emailMatches } = await supabase
            .from('contacts')
            .select('id, name, role_title, phone, email, created_at')
            .ilike('email', normEmail);

          if (emailMatches && emailMatches.length > 0) {
            const found = emailMatches.find((c) =>
              areContactNamesCompatible(c.name, trimmedName)
            );
            if (found) matchedContact = found;
          }
        }
      } catch (err) {
        console.warn('Aviso ao consultar contacts existentes no Supabase:', err);
      }
    }
  }

  // 3. SE ENCONTROU CONTATO COMPATÍVEL: REUTILIZAR AUTOMATICAMENTE
  // (NÃO altera os campos do contato existente — reutilização não é edição)
  if (matchedContact) {
    try {
      await ensureLeadContactLink(leadId, matchedContact.id);

      if (isPrimary) {
        saveLeadPrimaryContactOverride(leadId, matchedContact.id);
      }

      return {
        success: true,
        contact: matchedContact,
        reused: true,
        linkedToLead: true,
      };
    } catch (err: any) {
      console.error('Erro ao reutilizar vínculo do contato:', err);
      return {
        success: false,
        contact: matchedContact,
        reused: true,
        linkedToLead: false,
        error: err?.message || 'Falha ao vincular contato existente.',
      };
    }
  }

  // 4. SE NÃO ENCONTROU (NOME DIFERENTE OU PRIMEIRO CADASTRO): CRIAR NOVO CONTATO
  // (Aldair com mesmo telefone de Bruna cria novo contact para Aldair sem interferir em Bruna)
  try {
    const payload = buildContactDbPayload(contactState);
    const { data: createdContact, error: createErr } = await supabase
      .from('contacts')
      .insert([payload])
      .select('id, name, role_title, phone, email, created_at')
      .single();

    if (createErr || !createdContact) {
      throw createErr || new Error('Falha ao inserir novo contato em public.contacts.');
    }

    await ensureLeadContactLink(leadId, createdContact.id);

    if (isPrimary) {
      saveLeadPrimaryContactOverride(leadId, createdContact.id);
    }

    return {
      success: true,
      contact: createdContact,
      reused: false,
      linkedToLead: true,
    };
  } catch (err: any) {
    console.error('Erro ao criar novo contato e vincular:', err);
    return {
      success: false,
      contact: {
        id: `temp_${Date.now()}`,
        name: contactState.name,
        role_title: contactState.roleTitle,
        phone: contactState.phone,
        email: contactState.email,
      },
      reused: false,
      linkedToLead: false,
      error: err?.message || 'Falha ao cadastrar contato.',
    };
  }
}

/**
 * Garante que o vínculo (lead_id, contact_id) exista em public.lead_contacts sem duplicar.
 */
async function ensureLeadContactLink(leadId: string, contactId: string): Promise<void> {
  const { data: existingLink } = await supabase
    .from('lead_contacts')
    .select('lead_id, contact_id')
    .eq('lead_id', leadId)
    .eq('contact_id', contactId)
    .maybeSingle();

  if (!existingLink) {
    const { error: linkErr } = await supabase
      .from('lead_contacts')
      .insert([{ lead_id: leadId, contact_id: contactId }]);

    if (linkErr && linkErr.code !== '23505') {
      throw linkErr;
    }
  }
}

/**
 * Alias retrocompatível para componentes existentes que chamavam saveOrLinkContact.
 */
export async function saveOrLinkContact(params: ResolveOrCreateContactParams): Promise<ContactSaveResult> {
  return resolveOrCreateContact(params);
}
