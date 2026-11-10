import { Type, type FunctionDeclaration } from '@google/genai';
import { createClient } from '@supabase/supabase-js';

export type OperationType = 'read' | 'write';
export type RequiredAuth = 'active_user' | 'active_admin';

export interface ToolContext {
  userId: string;
  userToken?: string;
  isAdmin?: boolean;
  isActive?: boolean;
  userRole?: string;
  userPermissions?: Record<string, boolean>;
  scopedSupabase?: any;
  supabaseAdmin?: any;
  snapshot?: any;
  agentCapabilities?: Record<string, boolean>;
  agentName?: string;
  agentModelId?: string;
  agent?: any;
  customDataProvider?: (name: string, args: any) => Promise<any>;
}

export interface ToolParameterProperty {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: string[];
  items?: any;
}

export interface ToolParametersSchema {
  type: 'object';
  properties: Record<string, ToolParameterProperty>;
  required?: string[];
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  module: 'crm' | 'auditoria' | 'system';
  capabilityKey?: string;
  operationType: OperationType;
  requiredAuth: RequiredAuth;
  parameters: ToolParametersSchema;
  execute: (args: any, context: ToolContext) => Promise<any>;
}

class ToolRegistryClass {
  private tools: Map<string, ToolDefinition> = new Map();

  public registerTool(tool: ToolDefinition): void {
    if (!tool.name) {
      throw new Error('Impossível registrar ferramenta sem nome.');
    }
    this.tools.set(tool.name, tool);
  }

  public getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public getToolsForModule(moduleName: 'crm' | 'auditoria' | 'system'): ToolDefinition[] {
    return this.getAllTools().filter((t) => t.module === moduleName);
  }

  /**
   * Converte a definição de parâmetros canônica para o formato FunctionDeclaration do Google GenAI SDK.
   */
  public toGeminiTools(toolsList?: ToolDefinition[]): FunctionDeclaration[] {
    const list = toolsList || this.getAllTools();
    return list.map((tool) => {
      const geminiProps: Record<string, any> = {};
      for (const [key, prop] of Object.entries(tool.parameters.properties)) {
        let genType = Type.STRING;
        if (prop.type === 'integer' || prop.type === 'number') genType = Type.NUMBER;
        if (prop.type === 'boolean') genType = Type.BOOLEAN;
        if (prop.type === 'array') genType = Type.ARRAY;
        if (prop.type === 'object') genType = Type.OBJECT;

        geminiProps[key] = {
          type: genType,
          description: prop.description,
        };
      }

      return {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: Type.OBJECT,
          properties: geminiProps,
          required: tool.parameters.required,
        },
      };
    });
  }

  /**
   * Converte a definição de parâmetros canônica para o formato JSON Schema da OpenAI.
   */
  public toOpenAITools(toolsList?: ToolDefinition[]): any[] {
    const list = toolsList || this.getAllTools();
    return list.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: tool.parameters.properties,
          required: tool.parameters.required,
        },
      },
    }));
  }

  /**
   * Executor central de ferramentas com controle de autorização rigoroso por recurso, capacidade e tipo de operação.
   */
  public async executeTool(name: string, args: any, context: ToolContext): Promise<any> {
    const { userId, customDataProvider, agentCapabilities } = context || {};
    const supabaseAdmin = context?.supabaseAdmin || getDefaultSupabaseAdmin();

    // 1. Validação de autenticação obrigatória
    if (!userId || userId === 'anonymous') {
      return {
        ok: false,
        error: 'unauthorized',
        message: 'Acesso não autorizado: sessão de usuário inválida ou ausente.',
      };
    }

    // 2. Provedor de dados customizado para testes isolados
    if (customDataProvider) {
      return await customDataProvider(name, args);
    }

    const tool = this.getTool(name);
    if (!tool) {
      return {
        ok: false,
        error: 'unknown_tool',
        message: `Ferramenta "${name}" não está cadastrada no Tool Registry da Triverus.`,
      };
    }

    // 3. Validação do usuário e autorização
    let enrichedContext: ToolContext = { ...context, supabaseAdmin };

    if (supabaseAdmin && userId !== 'test_user') {
      try {
        const { data: profile, error: profErr } = await supabaseAdmin
          .from('profiles')
          .select('id, is_active, role, deleted_at')
          .eq('id', userId)
          .maybeSingle();

        if (profErr) {
          return {
            ok: false,
            error: 'database_error',
            message: `Erro ao verificar autorização do usuário: ${profErr.message}`,
          };
        }

        if (!profile || profile.is_active !== true || profile.deleted_at) {
          return {
            ok: false,
            error: 'inactive_user',
            message: 'Acesso negado: conta de usuário inativa ou inexistente no CRM Triverus.',
          };
        }

        const isAdmin = profile.role === 'admin';
        let userPerms = context.userPermissions;
        if (!userPerms) {
          const { data: up } = await supabaseAdmin
            .from('user_permissions')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
          userPerms = up || {};
        }

        enrichedContext = {
          ...enrichedContext,
          isAdmin: context.isAdmin ?? isAdmin,
          isActive: true,
          userRole: context.userRole || profile.role,
          userPermissions: userPerms,
        };
      } catch (err: any) {
        return {
          ok: false,
          error: 'database_error',
          message: `Erro ao validar usuário no CRM: ${err?.message || err}`,
        };
      }
    } else {
      // Para ambiente mock / test_user
      if (context.isActive === false) {
        return {
          ok: false,
          error: 'inactive_user',
          message: 'Acesso negado: conta inativa.',
        };
      }
    }

    // 4. Validação de capacidade do agente
    if (agentCapabilities && tool.capabilityKey) {
      const isCapEnabled = Boolean(agentCapabilities[tool.capabilityKey]);
      if (!isCapEnabled) {
        return {
          ok: false,
          error: 'capability_disabled',
          message: `A capacidade "${tool.capabilityKey}" está desabilitada para este agente.`,
        };
      }
    }

    // 5. Diferenciação de escrita: exige permissão individual específica (usando colunas reais de user_permissions)
    if (tool.operationType === 'write') {
      const hasWritePermission = Boolean(
        enrichedContext.isAdmin ||
        enrichedContext.userPermissions?.can_manage_leads ||
        enrichedContext.userPermissions?.can_manage_contacts ||
        enrichedContext.userPermissions?.can_manage_notes ||
        enrichedContext.userPermissions?.can_change_stage
      );

      if (!hasWritePermission) {
        return {
          ok: false,
          error: 'permission_denied',
          message: 'Acesso negado: seu usuário não possui permissão individual para criar ou editar registros no CRM.',
        };
      }

      return {
        ok: false,
        error: 'read_only_restriction',
        message: 'Operações de gravação/edição no CRM não são permitidas via chat. Faça a alteração pelo Pipeline.',
      };
    }

    // 6. Validação de permissão de administrador
    if (tool.requiredAuth === 'active_admin' && !enrichedContext.isAdmin) {
      return {
        ok: false,
        error: 'forbidden',
        message: 'Acesso negado: esta ferramenta requer privilégios de administrador ativo.',
      };
    }

    // 6. Executar a ferramenta
    try {
      return await tool.execute(args, enrichedContext);
    } catch (err: any) {
      return {
        ok: false,
        error: 'tool_execution_exception',
        message: `Erro ao executar a ferramenta "${name}": ${err?.message || err}`,
      };
    }
  }
}

let defaultAdminClient: any = null;
function getDefaultSupabaseAdmin(): any {
  if (defaultAdminClient) return defaultAdminClient;
  const url = (process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || '').trim();
  if (url && key) {
    try {
      defaultAdminClient = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      });
      return defaultAdminClient;
    } catch {
      return null;
    }
  }
  return null;
}

export const ToolRegistry = new ToolRegistryClass();
