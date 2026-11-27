// Conteúdo da página inicial pública (docs/specs/pagina-inicial.md, seção 8).
// Todo texto da página vem daqui; os componentes de components/landing/ só montam o layout.
// Proibido incluir credenciais, senhas ou e-mails de contas compartilhadas (A3).
// Textos de uso do assistente no canal seguem a DP6 (24/11/2026), decisão de Iago em 27/11/2026.

const VIDEOS_DIR = "/onboarding/videos";
const POSTERS_DIR = "/onboarding/posters";

/** Caminho público do vídeo (servido de public/onboarding/videos/). */
export function videoSrc(file: string): string {
  return `${VIDEOS_DIR}/${file}.mp4`;
}

/** Caminho público do pôster (servido de public/onboarding/posters/). */
export function posterSrc(file: string): string {
  return `${POSTERS_DIR}/${file}.jpg`;
}

// ---------- Tipos ----------

/** Nomes de ícones do lucide-react usados nos cards de funcionalidade. */
export type LandingIcon =
  | "LogIn"
  | "LayoutDashboard"
  | "Briefcase"
  | "Kanban"
  | "PanelsTopLeft"
  | "ChartColumn"
  | "MessageCircle"
  | "Settings";

export type LandingVideo = {
  /** Também é a âncora do player na página. */
  readonly id: string;
  /** Nome do arquivo sem extensão, igual em videos/ e posters/. */
  readonly file: string;
  readonly title: string;
  readonly description: string;
  /** Duração no formato "mm:ss". */
  readonly duration: string;
};

export type PrismaVideo = LandingVideo & { readonly icon: LandingIcon };

export type NavItem = { readonly href: `#${string}`; readonly label: string };

export type SectionHead = {
  /** Âncora da seção, quando houver (seção 7). */
  readonly anchor: string | null;
  readonly label: string;
  readonly title: string;
  readonly lead: string | null;
};

export type ToolCategory = { readonly id: string; readonly label: string };

export type Tool = {
  readonly id: string;
  readonly category: ToolCategory["id"];
  readonly name: string;
  readonly description: string;
  /** Nulo enquanto o endereço não estiver definido (A5): a página não exibe o botão. */
  readonly href: string | null;
  readonly linkLabel: string;
  readonly access: string;
};

export type EmphasisItem = { readonly title: string; readonly text: string };

export type WorkflowStep = { readonly step: number; readonly title: string; readonly text: string };

export type PracticeBlock = { readonly title: string; readonly items: readonly string[] };

export type FaqItem = { readonly question: string; readonly answer: string };

// ---------- Topo e abertura ----------

export const navItems: readonly NavItem[] = [
  { href: "#funcionalidades", label: "Funcionalidades" },
  { href: "#videos", label: "Vídeos do Prisma" },
  { href: "#discord", label: "Vídeos do Discord" },
  { href: "#ferramentas", label: "Ferramentas e links" },
  { href: "#fluxo", label: "Fluxo de trabalho" },
  { href: "#suporte", label: "Suporte" },
];

/** Rótulos do botão principal (P1): sem sessão ou carregando, "Entrar"; com sessão, "Ir para o Meu painel". */
export const primaryAction = {
  signedOut: "Entrar",
  signedIn: "Ir para o Meu painel",
} as const;

export const hero = {
  anchor: "inicio",
  label: "Gestão de projetos da Ambiente",
  title: "Projetos, prazos e conhecimento da consultoria em um só lugar.",
  text: "O Prisma reúne tarefas, indicadores, relatórios de status e o contexto de cada cliente. Esta página concentra o que a equipe precisa antes de entrar: o que a ferramenta faz, como usar e onde estão os demais sistemas da Ambiente.",
  secondaryAction: { href: "#videos", label: "Ver vídeos de uso" },
} as const;

export const accessCard = {
  anchor: "acesso",
  title: "Acesso",
  text: "Entre com seu e-mail corporativo ou com a conta do Discord vinculada.",
  firstAccess: { href: "#suporte", label: "Primeiro acesso" },
  note: "Acesso restrito à equipe da Ambiente e a convidados autorizados pelo administrador.",
} as const;

// ---------- Cabeçalhos das seções (protótipo validado) ----------

export const sections = {
  method: {
    anchor: null,
    label: "Metodologia",
    title: "O que o nome PRISMA significa",
    lead: null,
  },
  features: {
    anchor: "funcionalidades",
    label: "Funcionalidades",
    title: "O que você encontra depois do login",
    lead: "Cada bloco leva ao vídeo que mostra a funcionalidade em uso.",
  },
  prismaVideos: {
    anchor: "videos",
    label: "Vídeos de uso do Prisma",
    title: "Passo a passo em oito pílulas de cerca de um minuto",
    lead: "Assista na ordem no primeiro acesso ou vá direto à rotina que precisa. A série completa soma 8 minutos.",
  },
  discord: {
    anchor: "discord",
    label: "Vídeos de uso do Discord",
    title: "Use o assistente do Prisma sem sair da conversa",
    lead: "O Discord é o canal de conversa da equipe e a porta de entrada do assistente de IA. Comece pelo guia rápido ou vá direto à pílula do assunto.",
  },
  tools: {
    anchor: "ferramentas",
    label: "Ferramentas e links úteis",
    title: "A caixa de ferramentas digital da Ambiente",
    lead: "Atalhos para os sistemas usados no dia a dia. Cada bloco informa como obter o acesso.",
  },
  workflow: {
    anchor: "fluxo",
    label: "Fluxo de trabalho",
    title: "Qual ferramenta usar em cada etapa do projeto",
    lead: null,
  },
  practices: {
    anchor: null,
    label: "Boas práticas",
    title: "Combinados de uso das ferramentas",
    lead: null,
  },
  support: {
    anchor: "suporte",
    label: "Suporte",
    title: "Primeiros passos e dúvidas frequentes",
    lead: null,
  },
} as const satisfies Record<string, SectionHead>;

/** Rótulo do link dos cards de funcionalidade, seguido da duração. */
export const watchLabel = "Assistir";

// ---------- 8.2 Metodologia ----------

export const method: readonly { readonly letter: string; readonly name: string; readonly description: string }[] = [
  { letter: "P", name: "Processos", description: "Mapeamento e padronização do que é entregue." },
  { letter: "R", name: "Resultados", description: "Entregas e marcos acordados com o cliente." },
  { letter: "I", name: "Indicadores", description: "Medição do portfólio dentro da própria ferramenta." },
  { letter: "S", name: "Sistemas", description: "Ferramentas que sustentam a operação." },
  { letter: "M", name: "Melhoria", description: "Ações e aprendizados registrados por projeto." },
  { letter: "A", name: "Alinhamento", description: "Equipe e cliente com a mesma informação." },
];

// ---------- 8.3 Vídeos do Prisma (também alimentam os cards de Funcionalidades) ----------

export const prismaVideos: readonly PrismaVideo[] = [
  {
    id: "v-prisma-1",
    file: "prisma_pilula01_acesso_e_navegacao",
    title: "Acesso e navegação",
    description: "Entrar, se orientar pelo menu e vincular o Discord.",
    duration: "01:09",
    icon: "LogIn",
  },
  {
    id: "v-prisma-2",
    file: "prisma_pilula02_meu_painel",
    title: "Meu painel e notificações",
    description: "O que você precisa fazer agora, em uma tela.",
    duration: "01:00",
    icon: "LayoutDashboard",
  },
  {
    id: "v-prisma-3",
    file: "prisma_pilula03_projetos",
    title: "Projetos",
    description: "Criar, encontrar e configurar um projeto.",
    duration: "00:50",
    icon: "Briefcase",
  },
  {
    id: "v-prisma-4",
    file: "prisma_pilula04_tarefas",
    title: "Tarefas",
    description: "Quadro, ficha da tarefa, checklist, anexos e comentários.",
    duration: "01:11",
    icon: "Kanban",
  },
  {
    id: "v-prisma-5",
    file: "prisma_pilula05_abas_do_projeto",
    title: "As abas do projeto",
    description: "Lista, Cronograma, Documentos, Contexto, Membros, Escopos e Importar/Exportar.",
    duration: "01:08",
    icon: "PanelsTopLeft",
  },
  {
    id: "v-prisma-6",
    file: "prisma_pilula06_visao_do_portfolio",
    title: "Visão do portfólio",
    description: "Cronograma geral, Indicadores e Documentos.",
    duration: "00:46",
    icon: "ChartColumn",
  },
  {
    id: "v-prisma-7",
    file: "prisma_pilula07_assistente_discord",
    title: "O assistente no Discord",
    description: "Consultar e atualizar o Prisma conversando.",
    duration: "01:04",
    icon: "MessageCircle",
  },
  {
    id: "v-prisma-8",
    file: "prisma_pilula08_administracao",
    title: "Administração",
    description: "Conhecimento, clientes, parâmetros, usuários, permissões e auditoria.",
    duration: "00:55",
    icon: "Settings",
  },
];

// ---------- 8.4 Vídeos do Discord ----------

export const discordGuide: LandingVideo & { readonly label: string } = {
  id: "v-discord-guia",
  file: "discord_video_completo",
  label: "Guia rápido",
  title: "Agente Prisma no Discord",
  description: "O conteúdo das cinco pílulas em um único vídeo, para quem está chegando ao servidor.",
  duration: "02:15",
};

export const discordVideos: readonly LandingVideo[] = [
  {
    id: "v-discord-1",
    file: "discord_pilula01_primeiros_passos",
    title: "Primeiros passos no servidor",
    description: "Vincule a conta e conheça os canais.",
    duration: "00:47",
  },
  {
    id: "v-discord-2",
    file: "discord_pilula02_como_pedir",
    title: "Como pedir ao assistente",
    description: "Mensagem direta, menção no canal e consultas.",
    duration: "00:52",
  },
  {
    id: "v-discord-3",
    file: "discord_pilula03_previa_e_confirmacao",
    title: "Prévia e confirmação",
    description: "Nada é gravado sem você.",
    duration: "00:39",
  },
  {
    id: "v-discord-4",
    file: "discord_pilula04_arquivos_e_audio",
    title: "Arquivos e áudio",
    description: "O assistente lê documentos e ouve pedidos.",
    duration: "00:32",
  },
  {
    id: "v-discord-5",
    file: "discord_pilula05_skills",
    title: "Como usar uma skill",
    description: "Na mensagem direta e nos canais.",
    duration: "01:09",
  },
];

/** Regras exibidas ao lado do guia rápido. A primeira segue a DP6: o assistente responde no canal com @prisma. */
export const discordRules: readonly EmphasisItem[] = [
  {
    title: "No canal, a resposta é vista por todos.",
    text: "Para dados sensíveis, prefira a mensagem direta.",
  },
  {
    title: "Nada é gravado sem a sua confirmação.",
    text: "O assistente mostra uma prévia e aguarda o aceite.",
  },
  {
    title: "Você vê o mesmo que vê no Prisma.",
    text: "As permissões do seu perfil valem nas respostas.",
  },
];

// ---------- 8.5 Ferramentas e links ----------

/** Rótulo do filtro que mostra todas as categorias. */
export const allToolsFilter: ToolCategory = { id: "todas", label: "Todas" };

export const toolCategories: readonly ToolCategory[] = [
  { id: "conteudo", label: "Criação de conteúdo" },
  { id: "colaboracao", label: "Colaboração" },
  { id: "projetos", label: "Gestão de projetos" },
  { id: "ia", label: "Inteligência artificial" },
  { id: "normas", label: "Normas e conformidade" },
];

export const tools: readonly Tool[] = [
  {
    id: "gamma",
    category: "conteudo",
    name: "Gamma App",
    description: "Apresentações geradas a partir de prompts ou esboços, responsivas e com edição em tempo real.",
    href: "https://gamma.app",
    linkLabel: "Abrir Gamma",
    access: "Conta compartilhada da Ambiente. Solicite ao administrador.",
  },
  {
    id: "canva",
    category: "conteudo",
    name: "Canva",
    description: "Templates, Brand Kit e exportação em PDF, PNG e MP4 para materiais visuais.",
    href: "https://www.canva.com",
    linkLabel: "Abrir Canva",
    access: "Conta operacional compartilhada. Solicite ao administrador.",
  },
  {
    id: "miro",
    category: "colaboracao",
    name: "Miro",
    description: "Quadro para ideação, mapeamento de processos e facilitação de workshops.",
    href: "https://miro.com",
    linkLabel: "Abrir Miro",
    access: "Conta compartilhada da Ambiente. Solicite ao administrador.",
  },
  {
    id: "discord",
    category: "colaboracao",
    name: "Discord da Ambiente",
    description: "Um canal por projeto e o assistente de IA do Prisma por mensagem direta.",
    href: "https://discord.com/app",
    linkLabel: "Abrir Discord",
    access: "Convite enviado pelo administrador.",
  },
  {
    id: "modelo-importacao",
    category: "projetos",
    name: "Modelo de importação",
    description: "Arquivo padrão para subir tarefas e cronogramas no Prisma.",
    href: null, // A5: endereço a definir por Iago.
    linkLabel: "Baixar modelo",
    access: "Disponível a toda a equipe.",
  },
  {
    id: "chatgpt",
    category: "ia",
    name: "ChatGPT",
    description: "Apoio à redação, pesquisa, análise, revisão e aprendizado.",
    href: "https://chatgpt.com",
    linkLabel: "Abrir ChatGPT",
    access: "Sob alinhamento com a gestão do departamento.",
  },
  {
    id: "fireflies",
    category: "ia",
    name: "Fireflies.ai",
    description: "Gravação, transcrição em português e resumo de reuniões no Zoom, Meet e Teams.",
    href: "https://app.fireflies.ai",
    linkLabel: "Abrir Fireflies",
    access: "Conta compartilhada da Ambiente. Solicite ao administrador.",
  },
  {
    id: "target-normas",
    category: "normas",
    name: "Target Normas",
    description: "Consulta a normas ABNT, ISO, IEC e ASTM, com histórico de versões e alertas de atualização.",
    href: "https://www.target.com.br", // A5: confirmar o endereço do portal.
    linkLabel: "Abrir Target",
    access: "Conta da diretoria, com senha renovada periodicamente. Solicite ao administrador.",
  },
];

/** Prefixo do texto de acesso em cada card de ferramenta. */
export const toolAccessLabel = "Acesso:";

export const credentialsNotice: EmphasisItem = {
  title: "Credenciais:",
  text: "logins e senhas compartilhados ficam em área restrita após o login ou em um gerenciador de senhas. Esta página é aberta e não os exibe.",
};

// ---------- 8.6 Fluxo de trabalho ----------

export const workflow: readonly WorkflowStep[] = [
  {
    step: 1,
    title: "Planejamento",
    text: "Miro para o levantamento inicial. Prisma para estruturar o projeto com tarefas e prazos.",
  },
  {
    step: 2,
    title: "Execução",
    text: "Fireflies registra as reuniões, Target Normas valida a conformidade e o assistente no Discord guarda o contexto.",
  },
  {
    step: 3,
    title: "Comunicação",
    text: "Canva e Gamma para apresentações. Relatório de status do Prisma para o cliente.",
  },
  {
    step: 4,
    title: "Entrega",
    text: "Prisma consolida entregas, indicadores e o histórico do projeto para os próximos trabalhos.",
  },
];

// ---------- 8.7 Boas práticas ----------

export const practices: readonly PracticeBlock[] = [
  {
    title: "Segurança da informação",
    items: [
      "Não compartilhe credenciais com terceiros.",
      "Faça logout em dispositivos compartilhados.",
      "Prefira a mensagem direta para dados sensíveis de projeto.",
    ],
  },
  {
    title: "Produtividade",
    items: [
      "Atualize suas tarefas no Prisma todos os dias.",
      "Crie templates reutilizáveis no Canva e no Gamma.",
      "Mantenha os quadros do Miro organizados e arquive os finalizados.",
    ],
  },
  {
    title: "Colaboração",
    items: [
      "Converse sobre o projeto no canal dele no Discord.",
      "Marque os colegas envolvidos para dar visibilidade.",
      "Registre decisões e aprendizados no contexto do projeto.",
    ],
  },
];

// ---------- 8.8 Suporte ----------

export const firstSteps = {
  title: "Primeiros passos",
  steps: [
    { title: "Receba o convite.", text: "O administrador cadastra seu e-mail corporativo." },
    { title: "Defina sua senha.", text: "O link chega por e-mail." },
    { title: "Assista à pílula 1.", text: "Um minuto para entender o acesso e o menu." },
    { title: "Vincule o Discord.", text: "Em Minha conta, para usar o assistente." },
  ] satisfies readonly EmphasisItem[],
} as const;

export const faq = {
  title: "Dúvidas frequentes",
  items: [
    {
      question: "Não recebi o convite. O que faço?",
      answer: "Confira a caixa de spam e peça o reenvio ao administrador.",
    },
    {
      question: "O cliente consegue ver todo o projeto?",
      answer: "Não. O convidado externo vê e atualiza apenas as tarefas atribuídas ou compartilhadas com ele.",
    },
    {
      question: "O assistente não respondeu no canal. Por quê?",
      answer: "No canal, ele só responde quando é mencionado: escreva @prisma na mensagem. Pedidos em áudio só são transcritos na mensagem direta.",
    },
  ] satisfies readonly FaqItem[],
} as const;

const CONTACT_EMAIL = "iago@ambienteconsulta.com.br";
const ACCESS_SUBJECT = "Prisma - solicitação de acesso";

export const contact = {
  title: "Fale com o administrador",
  text: "Acesso, convites, erros e sugestões de melhoria.",
  name: "Iago Oliveira",
  email: CONTACT_EMAIL,
  requestAccess: {
    label: "Solicitar acesso",
    href: `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(ACCESS_SUBJECT)}`,
  },
} as const;

// ---------- Rodapé ----------

export const footer = {
  identification: "Prisma · Ambiente Consultoria Empresarial · Goiânia",
  notice: "Uso interno da equipe da Ambiente.",
} as const;
