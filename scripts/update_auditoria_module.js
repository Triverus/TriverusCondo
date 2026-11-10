import fs from 'fs';

let content = fs.readFileSync('src/components/AuditoriaModule.tsx', 'utf8');

// 1. Update CANONICAL_CATEGORIES with exact titles, descriptions, and cleaned aliases (Requirement 3)
const oldCategoriesTarget = `export const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  {
    id: 'convencao',
    name: 'Convenção do condomínio',
    description: 'Regras gerais, quóruns de deliberação, frações ideais e estrutura condominial',
    aliases: ['convencao', 'convencao_condominio'],
  },
  {
    id: 'regimento_interno',
    name: 'Regimento Interno',
    description: 'Normas de convivência, uso de áreas comuns, penalidades e rotinas internas',
    aliases: ['regimento_interno', 'regimento'],
  },
  {
    id: 'atas_assembleias',
    name: 'Atas de Assembleias do período auditado',
    description: 'Decisões deliberadas, eleições de síndico/conselho, aprovações de contas e orçamentos',
    aliases: ['atas_assembleias', 'ata_assembleia', 'atas', 'edital_convocacao_assembleia', 'editais_atas'],
  },
  {
    id: 'pastas_prestacao_contas',
    name: 'Pastas de prestação de contas',
    description: 'Balancetes, comprovantes de despesas, receitas, relatórios contábeis e fiscais',
    aliases: ['pastas_prestacao_contas', 'prestacao_contas', 'balancetes', 'pastas_contas', 'pasta_prestacao_contas'],
  },
  {
    id: 'extratos_bancarios',
    name: 'Extratos bancários',
    description: 'Contas correntes, aplicações financeiras, fundos de reserva e conciliação bancária',
    aliases: ['extratos_bancarios', 'extratos', 'extrato_bancario', 'banco'],
  },
  {
    id: 'previsao_orcamentaria',
    name: 'Previsão orçamentária do período auditado',
    description: 'Orçamento aprovado, cotas condominiais ordinárias/extraordinárias e metas financeiras',
    aliases: ['previsao_orcamentaria', 'orcamento', 'previsao_orcamento'],
  },
  {
    id: 'contratos_fornecedores',
    name: 'Contratos de fornecedores vigentes no período auditado',
    description: 'Manutenção, conservação, segurança, seguros, laudos técnicos, AVCB e prestadores de serviço',
    aliases: ['contratos_fornecedores', 'contratos', 'contrato_fornecedores', 'apolice_seguro', 'avcb_clcb', 'certificado_manutencao_elevadores'],
  },
];`;

const newCategories = `export const CANONICAL_CATEGORIES: CanonicalCategory[] = [
  {
    id: 'convencao',
    name: 'Convenção',
    description: 'Convenção do condomínio',
    aliases: ['convencao', 'convencao_condominio'],
  },
  {
    id: 'regimento_interno',
    name: 'Regimento Interno',
    description: 'Regras do condomínio',
    aliases: ['regimento_interno', 'regimento'],
  },
  {
    id: 'atas_assembleias',
    name: 'Atas',
    description: 'Assembleias do período auditado',
    aliases: ['atas_assembleias', 'ata_assembleia', 'atas'],
  },
  {
    id: 'pastas_prestacao_contas',
    name: 'Prestação de contas',
    description: 'Contas do condomínio',
    aliases: ['pastas_prestacao_contas', 'prestacao_contas', 'balancetes', 'pastas_contas', 'pasta_prestacao_contas'],
  },
  {
    id: 'extratos_bancarios',
    name: 'Extratos',
    description: 'Movimentações bancárias do período auditado',
    aliases: ['extratos_bancarios', 'extratos', 'extrato_bancario', 'banco'],
  },
  {
    id: 'previsao_orcamentaria',
    name: 'Previsão Orçamentária',
    description: 'Período auditado',
    aliases: ['previsao_orcamentaria', 'orcamento', 'previsao_orcamento'],
  },
  {
    id: 'contratos_fornecedores',
    name: 'Contratos',
    description: 'Fornecedores vigentes no período auditado',
    aliases: ['contratos_fornecedores', 'contratos', 'contrato_fornecedores'],
  },
];`;

if (content.includes(oldCategoriesTarget)) {
  content = content.replace(oldCategoriesTarget, newCategories);
  console.log('CANONICAL_CATEGORIES updated!');
} else {
  console.warn('Could not find exact oldCategoriesTarget');
}

// 2. Add FolderLink and AvailableFolder interfaces
if (!content.includes('export interface FolderLink {')) {
  const targetInterface = `export interface LinkedDocument {
  id: string;
  condo_id: string;
  category: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_file_size: number | null;
  drive_file_modified_at: string | null;
  linked_by_user_id: string | null;
  created_at: string;
  updated_at: string;
  persisted_definitively?: boolean;
}`;

  const newInterfaces = `export interface FolderLink {
  id: string;
  condo_id: string;
  category: string;
  drive_folder_id: string;
  drive_folder_name: string;
  last_synced_at?: string;
  persisted_definitively?: boolean;
}

export interface AvailableFolder {
  id: string;
  name: string;
  path: string;
  is_condo_root: boolean;
  pdf_count?: number;
  createdTime?: string;
  modifiedTime?: string;
}

export interface LinkedDocument {
  id: string;
  condo_id: string;
  category: string;
  drive_file_id: string;
  drive_file_name: string;
  drive_file_size: number | null;
  drive_file_modified_at: string | null;
  linked_by_user_id: string | null;
  origin_folder_id?: string | null;
  origin_folder_name?: string | null;
  sync_status?: string | null;
  created_at: string;
  updated_at: string;
  persisted_definitively?: boolean;
}`;

  content = content.replace(targetInterface, newInterfaces);
  console.log('Interfaces updated!');
}

fs.writeFileSync('src/components/AuditoriaModule.tsx', content, 'utf8');
