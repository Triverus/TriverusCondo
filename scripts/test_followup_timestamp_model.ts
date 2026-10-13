import {
  buildSaoPauloIsoDateTime,
  extractSaoPauloTime,
  toDateInputValue,
  formatDateBR,
  resolveFollowUpDateAndTime,
  getFollowUpTime,
  saveFollowUpTime,
  BRAZIL_TIMEZONE,
} from '../src/lib/dateUtils.ts';
import { parseDateTime, selectCanonicalFollowups } from '../src/lib/crmSelectors.ts';

// Mock localStorage para ambiente Node.js de teste
const mockStorage: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
  length: 0,
  key: (i: number) => Object.keys(mockStorage)[i] || null,
} as any;

interface TestReport {
  id: string;
  title: string;
  passed: boolean;
  details: Record<string, any>;
}

const reports: TestReport[] = [];

console.log('====================================================');
console.log('EXECUÇÃO DOS TESTES ESTRUTURAIS: MODELO DE FOLLOW-UP');
console.log('====================================================\n');

// ----------------------------------------------------
// TESTE A: NOVO FOLLOW-UP (Data: 25/10/2026, Horário: 14:30)
// ----------------------------------------------------
try {
  const dateInput = '2026-10-25';
  const timeInput = '14:30';

  const next_follow_up_at = buildSaoPauloIsoDateTime(dateInput, timeInput);
  const next_follow_up_date = toDateInputValue(dateInput);
  const google_event_id = null;

  // Validação do timestamp com offset correto do Brasil (-03:00)
  const isCorrectIso = next_follow_up_at === '2026-10-25T14:30:00-03:00';
  const isCorrectLegacyDate = next_follow_up_date === '2026-10-25';

  // Validação de timezone UTC correspondente
  const utcDate = new Date(next_follow_up_at);
  const utcIso = utcDate.toISOString(); // 2026-10-25T17:30:00.000Z

  const passedA = isCorrectIso && isCorrectLegacyDate && google_event_id === null;

  reports.push({
    id: 'TESTE A',
    title: 'Novo follow-up gera next_follow_up_at em America/Sao_Paulo (-03:00) e sincroniza next_follow_up_date',
    passed: passedA,
    details: {
      next_follow_up_at,
      next_follow_up_date,
      google_event_id,
      utcEquivalent: utcIso,
    },
  });
} catch (err: any) {
  reports.push({ id: 'TESTE A', title: 'Novo follow-up', passed: false, details: { error: err.message } });
}

// ----------------------------------------------------
// TESTE B: REABERTURA (Não depender de localStorage)
// ----------------------------------------------------
try {
  // Simular que o banco Supabase retornou o timestamptz (em formato ISO UTC ou com offset)
  const savedAtFromDb = '2026-10-25T17:30:00+00:00'; // Retorno real de timestamptz do Supabase
  const savedDateFromDb = '2026-10-25';

  // Limpar expressamente o localStorage para garantir que não há dependência local
  localStorage.clear();

  const resolved = resolveFollowUpDateAndTime(savedAtFromDb, savedDateFromDb, 'interaction_test_new', 'lead_test_new');

  const passedB = resolved.date === '2026-10-25' && resolved.time === '14:30' && resolved.source === 'database';

  reports.push({
    id: 'TESTE B',
    title: 'Reabertura de novo follow-up recupera 25/10/2026 às 14:30 direto do banco (sem localStorage)',
    passed: passedB,
    details: {
      resolvedDate: resolved.date,
      resolvedTime: resolved.time,
      source: resolved.source,
      localStorageConsulted: false,
    },
  });
} catch (err: any) {
  reports.push({ id: 'TESTE B', title: 'Reabertura', passed: false, details: { error: err.message } });
}

// ----------------------------------------------------
// TESTE C: FOLLOW-UP ANTIGO (next_follow_up_at = NULL, next_follow_up_date preenchido)
// ----------------------------------------------------
try {
  const legacyInteractionId = 'int_legacy_999';
  const legacyLeadId = 'lead_legacy_888';
  const legacyDate = '2026-09-17';

  // 1. Caso com horário salvo previamente no localStorage
  saveFollowUpTime(legacyInteractionId, legacyLeadId, '10:00');
  const resolvedWithStorage = resolveFollowUpDateAndTime(null, legacyDate, legacyInteractionId, legacyLeadId);

  // 2. Caso sem horário no localStorage (fallback padrão 09:00)
  localStorage.clear();
  const resolvedWithoutStorage = resolveFollowUpDateAndTime(null, legacyDate, legacyInteractionId, legacyLeadId);

  const passedC =
    resolvedWithStorage.date === '2026-09-17' &&
    resolvedWithStorage.time === '10:00' &&
    resolvedWithStorage.source === 'localStorage' &&
    resolvedWithoutStorage.date === '2026-09-17' &&
    resolvedWithoutStorage.time === '09:00' &&
    resolvedWithoutStorage.source === 'fallback';

  reports.push({
    id: 'TESTE C',
    title: 'Follow-up legado preserva fallback de horário via localStorage e fallback geral 09:00',
    passed: passedC,
    details: {
      withStorage: resolvedWithStorage,
      withoutStorage: resolvedWithoutStorage,
    },
  });
} catch (err: any) {
  reports.push({ id: 'TESTE C', title: 'Follow-up antigo', passed: false, details: { error: err.message } });
}

// ----------------------------------------------------
// TESTE D: EDITAR LEGADO (Promover para next_follow_up_at)
// ----------------------------------------------------
try {
  const legacyInteractionId = 'int_legacy_update_777';
  const legacyLeadId = 'lead_legacy_update_666';

  // Follow-up antigo antes da edição
  let interaction: any = {
    id: legacyInteractionId,
    lead_id: legacyLeadId,
    interaction_type: 'Ligação',
    occurred_at: '2026-09-10T12:00:00Z',
    next_follow_up_date: '2026-09-17',
    next_follow_up_at: null,
    google_event_id: null,
  };

  // Usuário edita o registro e define nova data 28/10/2026 às 16:00
  const editDate = '2026-10-28';
  const editTime = '16:00';

  const newNextFollowUpAt = buildSaoPauloIsoDateTime(editDate, editTime);
  const newNextFollowUpDate = toDateInputValue(editDate);

  // Atualização simulada da row
  interaction = {
    ...interaction,
    next_follow_up_at: newNextFollowUpAt,
    next_follow_up_date: newNextFollowUpDate,
  };

  // Limpa o localStorage para comprovar que agora a fonte oficial é o banco
  localStorage.clear();

  const reloaded = resolveFollowUpDateAndTime(
    interaction.next_follow_up_at,
    interaction.next_follow_up_date,
    interaction.id,
    interaction.lead_id
  );

  const passedD =
    interaction.next_follow_up_at === '2026-10-28T16:00:00-03:00' &&
    interaction.next_follow_up_date === '2026-10-28' &&
    reloaded.date === '2026-10-28' &&
    reloaded.time === '16:00' &&
    reloaded.source === 'database';

  reports.push({
    id: 'TESTE D',
    title: 'Edição de registro legado preenche next_follow_up_at e torna o banco a fonte oficial',
    passed: passedD,
    details: {
      next_follow_up_at: interaction.next_follow_up_at,
      next_follow_up_date: interaction.next_follow_up_date,
      reloaded,
    },
  });
} catch (err: any) {
  reports.push({ id: 'TESTE D', title: 'Editar legado', passed: false, details: { error: err.message } });
}

// ----------------------------------------------------
// TESTE ADICIONAL: SELECTORS / READ MODEL PRIORITIZANDO next_follow_up_at
// ----------------------------------------------------
try {
  const mockLeads = [{ id: 'lead_1', name: 'Residencial Aurora', current_stage_id: 'stg_1' }];
  const mockInteractions = [
    {
      id: 'int_new',
      lead_id: 'lead_1',
      interaction_type: 'Reunião',
      occurred_at: '2026-10-13T10:00:00Z',
      next_follow_up_at: '2026-10-25T17:30:00+00:00', // 14:30 SP
      next_follow_up_date: '2026-10-25',
      notes: 'Alinhamento com conselho',
      responsible_user_id: 'user_1',
    },
  ];
  const profileMap = new Map([['user_1', 'Rogério']]);
  const stageMap = new Map([['stg_1', 'Reunião']]);
  const followUpItems = selectCanonicalFollowups(mockInteractions, mockLeads, profileMap, stageMap);
  const selectorItem = followUpItems[0];

  const passedSelector =
    selectorItem &&
    selectorItem.date === '25/10/2026' &&
    selectorItem.time === '14:30' &&
    selectorItem.scheduledAt === '2026-10-25T17:30:00+00:00';

  reports.push({
    id: 'TESTE SELECTOR',
    title: 'selectCanonicalFollowups lê e formata next_follow_up_at no fuso de São Paulo com prioridade',
    passed: passedSelector,
    details: {
      itemDate: selectorItem?.date,
      itemTime: selectorItem?.time,
      scheduledAt: selectorItem?.scheduledAt,
    },
  });
} catch (err: any) {
  reports.push({ id: 'TESTE SELECTOR', title: 'Selector test', passed: false, details: { error: err.message } });
}

// Exibir resultados
console.log('====================================================');
console.log('RESULTADOS DOS TESTES');
console.log('====================================================');

let allPassed = true;
for (const r of reports) {
  const icon = r.passed ? '✅ [PASS]' : '❌ [FAIL]';
  if (!r.passed) allPassed = false;
  console.log(`${icon} ${r.id}: ${r.title}`);
  console.log(`   Detalhes: ${JSON.stringify(r.details)}\n`);
}

console.log('----------------------------------------------------');
if (allPassed) {
  console.log('STATUS: TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
} else {
  console.error('STATUS: UM OU MAIS TESTES FALHARAM.');
  process.exit(1);
}
console.log('----------------------------------------------------');
