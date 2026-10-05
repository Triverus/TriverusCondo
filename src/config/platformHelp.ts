export interface PlatformHelpItem {
  id: string;
  title: string;
  category: 'pipeline' | 'contacts' | 'followups' | 'notes' | 'drive' | 'general';
  intent?: string;
  keywords: string[];
  description: string;
  steps: string[];
  route: string;
  target?: string;
  highlightTitle?: string;
  highlightDescription?: string;
  image?: string | null;
  imageHighlight?: {
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  } | null;
}

export const PLATFORM_HELP_ITEMS: PlatformHelpItem[] = [
  {
    id: 'add-condominium',
    title: 'Cadastrar novo condomínio',
    category: 'pipeline',
    intent: 'create_lead',
    keywords: [
      'cadastrar condomínio',
      'criar condomínio',
      'novo condomínio',
      'adicionar lead',
      'novo lead',
      'cadastrar lead',
    ],
    description: 'Como incluir um novo condomínio no CRM Triverus.',
    steps: [
      'Navegue até a tela do Pipeline.',
      'Clique no botão "+ Novo Condomínio" no topo superior direito.',
      'Preencha nome, cidade, unidades, administradora, temperatura e etapa.',
      'Clique em "Salvar Condomínio".',
    ],
    route: '/app/pipeline',
    target: 'new-condominium',
    highlightTitle: 'Novo Condomínio',
    highlightDescription: 'Clique aqui para cadastrar um novo condomínio no Pipeline.',
  },
  {
    id: 'edit-condominium',
    title: 'Editar dados do condomínio',
    category: 'pipeline',
    intent: 'edit_lead',
    keywords: [
      'editar condomínio',
      'alterar condomínio',
      'mudar dados condomínio',
      'editar nome',
      'editar administradora',
      'editar unidades',
      'alterar dados',
    ],
    description: 'Como atualizar informações cadastrais de um condomínio.',
    steps: [
      'Abra a tela do Pipeline.',
      'Localize o card do condomínio desejado.',
      'Abra o menu de três pontos ⋯ no topo do card.',
      'Selecione "Editar card" para modificar as informações.',
      'Atualize os dados e clique em "Salvar".',
    ],
    route: '/app/pipeline',
    target: 'lead-card-edit',
    highlightTitle: 'Editar Condomínio',
    highlightDescription: 'Abra este menu e selecione "Editar card" para alterar nome, cidade ou unidades.',
  },
  {
    id: 'delete-condominium',
    title: 'Excluir condomínio',
    category: 'pipeline',
    intent: 'delete_lead',
    keywords: [
      'excluir condomínio',
      'deletar condomínio',
      'apagar condomínio',
      'remover condomínio',
      'excluir lead',
      'como excluo um condomínio',
      'como apagar um condomínio',
    ],
    description: 'Como remover um condomínio do sistema Triverus.',
    steps: [
      'Acesse a tela do Pipeline.',
      'Localize o card do condomínio que deseja remover.',
      'Clique no menu de três pontos ⋯ no canto superior direito do card.',
      'Clique na opção "Excluir condomínio" (em destaque vermelho).',
      'Confirme a exclusão no aviso que aparecerá.',
    ],
    route: '/app/pipeline',
    target: 'lead-card-edit',
    highlightTitle: 'Excluir Condomínio',
    highlightDescription: 'Abra o menu de três pontos ⋯ no topo do card do condomínio e clique em "Excluir condomínio".',
  },
  {
    id: 'change-temperature',
    title: 'Alterar temperatura do condomínio',
    category: 'pipeline',
    intent: 'change_temperature',
    keywords: [
      'mudar temperatura',
      'alterar temperatura',
      'frio',
      'morno',
      'quente',
      'cliente',
      'qualificar lead',
    ],
    description: 'Como alterar o nível de qualificação/temperatura de um condomínio.',
    steps: [
      'Acesse a tela do Pipeline.',
      'No card do condomínio, clique sobre a temperatura ou no badge da cor.',
      'Selecione entre Frio, Morno, Quente ou Cliente.',
      'A alteração é salva instantaneamente.',
    ],
    route: '/app/pipeline',
    target: 'pipeline-temperature',
    highlightTitle: 'Temperatura do Condomínio',
    highlightDescription: 'Clique no seletor de temperatura para alterar o nível de qualificação (Frio, Morno, Quente ou Cliente).',
  },
  {
    id: 'move-pipeline-stage',
    title: 'Mover condomínio no funil / etapa',
    category: 'pipeline',
    intent: 'move_stage',
    keywords: [
      'mover condomínio',
      'alterar etapa',
      'mudar fase',
      'mudar estágio',
      'passar de etapa',
      'avançar funil',
    ],
    description: 'Como avançar ou recuar um condomínio nas colunas do Pipeline.',
    steps: [
      'Acesse a tela do Pipeline.',
      'Arraste o card do condomínio para a coluna da etapa desejada.',
      'Ou clique no badge de etapa direto no card para selecionar a nova fase.',
    ],
    route: '/app/pipeline',
    target: 'pipeline-stage',
    highlightTitle: 'Estágio no Funil',
    highlightDescription: 'Clique no badge da etapa para alterar o estágio do condomínio ou arraste o card entre as colunas.',
  },
  {
    id: 'add-whatsapp-contact',
    title: 'Adicionar ou alterar contato do condomínio',
    category: 'contacts',
    intent: 'manage_contact',
    keywords: [
      'adicionar whatsapp',
      'cadastrar whatsapp',
      'adicionar contato',
      'alterar contato',
      'editar contato',
      'mudar contato',
      'mudar telefone',
      'telefone do síndico',
      'contato do síndico',
      'whats',
      'whatsapp',
      'como altero um contato',
      'como mudo um contato',
      'como adiciono um contato',
    ],
    description: 'Como gerenciar o contato ou WhatsApp do síndico/responsável pelo card do condomínio.',
    steps: [
      'Os contatos são gerenciados pelo card do condomínio no Pipeline.',
      'No rodapé do card, clique no ícone do WhatsApp ou E-mail.',
      'Edite ou adicione o nome, cargo (ex: Síndico) e telefone do contato.',
      'Clique em "Salvar Contato".',
    ],
    route: '/app/pipeline',
    target: 'lead-card-whatsapp',
    highlightTitle: 'Contatos pelo WhatsApp',
    highlightDescription: 'Clique no ícone do WhatsApp no rodapé do card para visualizar, adicionar ou editar contatos com telefone.',
  },
  {
    id: 'add-email-contact',
    title: 'Adicionar e-mail de contato',
    category: 'contacts',
    intent: 'add_email',
    keywords: [
      'adicionar e-mail',
      'cadastrar e-mail',
      'adicionar email',
      'email do síndico',
      'mudar email',
    ],
    description: 'Como cadastrar o e-mail de um contato vinculado ao condomínio.',
    steps: [
      'No Pipeline, localize o card do condomínio.',
      'No rodapé do card, clique no ícone de E-mail.',
      'Informe o nome, cargo e o endereço de e-mail do contato.',
      'Clique em "Salvar Contato".',
    ],
    route: '/app/pipeline',
    target: 'lead-card-email',
    highlightTitle: 'Contatos por E-mail',
    highlightDescription: 'Clique no ícone de E-mail no rodapé do card para visualizar, cadastrar ou editar e-mails de contato.',
  },
  {
    id: 'add-note',
    title: 'Registrar anotação ou ligação',
    category: 'notes',
    intent: 'add_note',
    keywords: [
      'registrar nota',
      'criar nota',
      'nova anotação',
      'registrar ligação',
      'agendar follow-up',
      'registrar reunião',
      'adicionar nota',
    ],
    description: 'Como registrar o histórico de uma conversa ou agendar o próximo contato.',
    steps: [
      'No card do condomínio no Pipeline, clique no botão redondo "+" de anotações.',
      'Escolha o tipo de contato (Ligação, WhatsApp, Reunião, etc.).',
      'Digite o resumo da conversa e defina a data de retorno se houver.',
      'Clique em "Salvar Nota".',
    ],
    route: '/app/pipeline',
    target: 'lead-card-notes',
    highlightTitle: 'Registrar Anotação ou Follow-up',
    highlightDescription: 'Clique no botão "+" para registrar uma ligação, mensagem ou reunião e agendar a data de retorno.',
  },
  {
    id: 'view-followups',
    title: 'Gerenciar Follow-ups e Agendamentos',
    category: 'followups',
    intent: 'view_followups',
    keywords: [
      'ver followups',
      'follow-ups',
      'agendamentos',
      'vencidos',
      'contatos hoje',
      'próximo contato',
      'onde fico followups',
    ],
    description: 'Como acompanhar os compromissos e retornos agendados.',
    steps: [
      'Clique na aba "Follow-ups" no menu superior.',
      'Visualize os contatos organizados por: Vencidos, Hoje, Amanhã e Futuros.',
      'Clique no card para atualizar a data de retorno ou concluir o atendimento.',
    ],
    route: '/app/followups',
    target: 'followups-menu',
    highlightTitle: 'Menu de Follow-ups',
    highlightDescription: 'Clique na aba Follow-ups no topo para visualizar todos os compromissos agendados e pendentes.',
  },
  {
    id: 'open-drive-folder',
    title: 'Acessar pasta do Google Drive',
    category: 'drive',
    intent: 'open_drive',
    keywords: [
      'pasta do condomínio',
      'google drive',
      'abrir pasta',
      'documentos',
      'link da pasta',
      'como abro a pasta',
    ],
    description: 'Como acessar a pasta de documentos do condomínio.',
    steps: [
      'No card do condomínio no Pipeline, clique no ícone de Pasta/Drive.',
      'Clique no link para abrir a pasta do Google Drive em nova aba.',
      'Se a pasta ainda não estiver vinculada, insira a URL do Drive e salve.',
    ],
    route: '/app/pipeline',
    target: 'lead-card-folder',
    highlightTitle: 'Pasta de Documentos',
    highlightDescription: 'Clique no ícone de Pasta no rodapé do card para acessar ou cadastrar a URL da pasta no Google Drive.',
  },
  {
    id: 'search-pipeline',
    title: 'Pesquisar e filtrar condomínios',
    category: 'pipeline',
    intent: 'search_pipeline',
    keywords: [
      'pesquisar condomínio',
      'buscar lead',
      'filtrar temperatura',
      'filtrar por cidade',
      'como busco',
    ],
    description: 'Como localizar condomínios rapidamente no Pipeline.',
    steps: [
      'No topo da tela do Pipeline, clique na barra de busca.',
      'Digite o nome do condomínio, cidade ou administradora.',
      'Filtre rapidamente por estágio no menu de seleção.',
    ],
    route: '/app/pipeline',
    target: 'pipeline-search',
    highlightTitle: 'Barra de Pesquisa',
    highlightDescription: 'Digite o nome do condomínio ou cidade para filtrar o Pipeline em tempo real.',
  },
];

export function searchPlatformHelp(query: string): PlatformHelpItem[] {
  if (!query || typeof query !== 'string') return [];
  const rawQ = query.trim().toLowerCase();
  if (!rawQ) return [];

  // Stopwords filtering
  const stopWords = new Set([
    'como', 'fazer', 'faço', 'onde', 'posso', 'mudar', 'alterar', 'novo', 'uma', 'um',
    'para', 'sobre', 'qual', 'quero', 'ver', 'me', 'diga', 'o', 'a', 'os', 'as', 'de', 'do', 'da', 'excluir', 'apagar'
  ]);

  const tokens = rawQ.split(/[\s,?.!;/]+/).filter((w) => w.length > 1 && !stopWords.has(w));

  // Score each help item
  const scored = PLATFORM_HELP_ITEMS.map((item) => {
    let score = 0;

    // Check specific delete query
    if ((rawQ.includes('excluir') || rawQ.includes('deletar') || rawQ.includes('apagar')) && item.id === 'delete-condominium') {
      score += 40;
    }

    // Direct keyword exact match
    for (const kw of item.keywords) {
      const kwLower = kw.toLowerCase();
      if (rawQ.includes(kwLower)) {
        score += 20;
      }
    }

    // Direct title match
    if (rawQ.includes(item.title.toLowerCase())) {
      score += 25;
    }

    // Token matching
    for (const token of tokens) {
      if (item.title.toLowerCase().includes(token)) score += 10;
      for (const kw of item.keywords) {
        if (kw.toLowerCase().includes(token)) score += 8;
      }
      if (item.description.toLowerCase().includes(token)) score += 3;
    }

    // Penalty if query mentions contact/whatsapp/sindico but item is add-condominium
    if (
      (rawQ.includes('contato') || rawQ.includes('whatsapp') || rawQ.includes('sindico') || rawQ.includes('síndico') || rawQ.includes('telefone')) &&
      item.id === 'add-condominium'
    ) {
      score = 0;
    }

    return { item, score };
  });

  const best = scored.filter((s) => s.score > 5).sort((a, b) => b.score - a.score);

  if (best.length > 0) {
    return [best[0].item];
  }

  return [];
}
