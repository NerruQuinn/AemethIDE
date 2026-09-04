import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

export interface TestConnectionResult {
  success: boolean;
  error?: string;
  errorCode?: string;
  models?: string[];
}

export default class OpenAILikeProvider extends BaseProvider {
  name = 'OpenAILike';
  displayName = 'OpenAI Compatible';
  getApiKeyLink = undefined;

  config = {
    baseUrlKey: 'OPENAI_LIKE_API_BASE_URL',
    apiTokenKey: 'OPENAI_LIKE_API_KEY',
  };

  staticModels: ModelInfo[] = [];

  async testConnection(baseUrl: string, apiKey: string, model?: string): Promise<TestConnectionResult> {
    // Clean up base URL - remove trailing slash
    let cleanBaseUrl = baseUrl.trim();
    if (cleanBaseUrl.endsWith('/')) {
      cleanBaseUrl = cleanBaseUrl.slice(0, -1);
    }

    // Validate inputs
    if (!cleanBaseUrl) {
      return { success: false, error: 'Base URL is required', errorCode: 'MISSING_BASE_URL' };
    }
    if (!apiKey) {
      return { success: false, error: 'API Key is required', errorCode: 'MISSING_API_KEY' };
    }

    // Validate URL format
    try {
      new URL(cleanBaseUrl);
    } catch {
      return { success: false, error: 'Invalid Base URL format', errorCode: 'INVALID_BASE_URL' };
    }

    // Try to fetch models to validate connection
    try {
      const response = await fetch(`${cleanBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          return { success: false, error: 'Unauthorized - Invalid API Key', errorCode: 'UNAUTHORIZED' };
        }
        if (response.status === 404) {
          return { success: false, error: 'Models endpoint not found', errorCode: 'NOT_FOUND' };
        }
        if (response.status === 429) {
          return { success: false, error: 'Rate limited - Too many requests', errorCode: 'RATE_LIMITED' };
        }
        return {
          success: false,
          error: `Server error (${response.status})`,
          errorCode: 'SERVER_ERROR',
        };
      }

      const res = (await response.json()) as any;
      const models: string[] = [];

      // Extract model IDs from response
      if (res.data && Array.isArray(res.data)) {
        models.push(...res.data.map((m: any) => m.id));
      }

      // If model is specified, try to validate it exists
      if (model && model.trim()) {
        const modelExists = models.some(
          (m) => m.toLowerCase() === model.toLowerCase() || m.toLowerCase().includes(model.toLowerCase()),
        );

        if (!modelExists && models.length > 0) {
          // Model not found but connection is OK - just warn
          return {
            success: true,
            error: `Model "${model}" not found in available models. Connection successful but you may need to update the model ID.`,
            errorCode: 'MODEL_NOT_FOUND',
            models,
          };
        }
      }

      return { success: true, models };
    } catch (err: any) {
      if (err.name === 'TypeError' && err.message.includes('fetch')) {
        return {
          success: false,
          error: 'Network error - Check Base URL and CORS settings',
          errorCode: 'NETWORK_ERROR',
        };
      }
      return { success: false, error: err.message || 'Connection failed', errorCode: 'UNKNOWN_ERROR' };
    }
  }

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv: Record<string, string> = {},
  ): Promise<ModelInfo[]> {
    // Read baseUrl from providerSettings, env, or default
    let baseUrl = settings?.baseUrl || process?.env?.OPENAI_LIKE_API_BASE_URL || serverEnv?.OPENAI_LIKE_API_BASE_URL;

    // Read apiKey from providerSettings or apiKeys object
    let apiKey =
      settings?.apiKey || apiKeys?.[this.name] || process?.env?.OPENAI_LIKE_API_KEY || serverEnv?.OPENAI_LIKE_API_KEY;

    if (!baseUrl) {
      return [];
    }

    // Clean up base URL
    let cleanBaseUrl = baseUrl;
    if (cleanBaseUrl.endsWith('/')) {
      cleanBaseUrl = cleanBaseUrl.slice(0, -1);
    }

    const modelMap = new Map<string, ModelInfo>();
    const addModel = (name: string) => {
      const id = name.trim();

      if (id) {
        modelMap.set(id, { name: id, label: id, provider: this.name, maxTokenAllowed: 8000 });
      }
    };

    /*
     * Always surface the manually configured model so it stays selectable in the
     * homepage provider selector even when the endpoint does not implement GET /models.
     */
    const manualModel = settings?.model?.trim();

    if (manualModel) {
      addModel(manualModel);
    }

    if (apiKey) {
      try {
        const response = await fetch(`${cleanBaseUrl}/models`, {
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        if (response.ok) {
          const res = (await response.json()) as any;

          if (res.data && Array.isArray(res.data)) {
            res.data.forEach((model: any) => model?.id && addModel(String(model.id)));
          }
        }
      } catch {
        // Endpoint may not expose /models; the manual model above is still selectable.
      }
    }

    return [...modelMap.values()];
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const providerSetting = providerSettings?.[this.name];

    // Read baseUrl from providerSettings, env, or default
    let baseUrl =
      providerSetting?.baseUrl || process?.env?.OPENAI_LIKE_API_BASE_URL || serverEnv?.OPENAI_LIKE_API_BASE_URL;

    // Read apiKey from providerSettings or apiKeys object
    let apiKey =
      providerSetting?.apiKey ||
      apiKeys?.[this.name] ||
      process?.env?.OPENAI_LIKE_API_KEY ||
      serverEnv?.OPENAI_LIKE_API_KEY;

    if (!baseUrl || !apiKey) {
      throw new Error(
        `Missing configuration for ${this.name} provider. Base URL: ${baseUrl ? 'set' : 'missing'}, API Key: ${apiKey ? 'set' : 'missing'}`,
      );
    }

    // Clean up base URL - remove trailing slash
    let cleanBaseUrl = baseUrl;
    if (cleanBaseUrl.endsWith('/')) {
      cleanBaseUrl = cleanBaseUrl.slice(0, -1);
    }

    return getOpenAILikeModel(cleanBaseUrl, apiKey, model);
  }
}
