import React, { useEffect, useState, useCallback } from 'react';
import { Switch } from '~/components/ui/Switch';
import { useSettings } from '~/lib/hooks/useSettings';
import type { IProviderConfig } from '~/types/model';
import { motion } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { BiCodeBlock, BiRefresh, BiCheck, BiX } from 'react-icons/bi';
import { toast } from 'react-toastify';
import Cookies from 'js-cookie';
import type { TestConnectionResult } from '~/lib/modules/llm/providers/openai-like';
import OpenAILikeProvider from '~/lib/modules/llm/providers/openai-like';

// Types for API responses
interface ModelsResponse {
  data?: Array<{ id: string }>;
}

const PROVIDER_NAME = 'OpenAILike';
const BASE_URL_COOKIE_KEY = `${PROVIDER_NAME}_baseUrl`;
const API_KEY_COOKIE_KEY = 'apiKeys';
const MODEL_COOKIE_KEY = `${PROVIDER_NAME}_model`;

// Read/write API key cookie (shared format with existing APIKeyManager)
const readApiKeys = (): Record<string, string> => {
  const raw = Cookies.get(API_KEY_COOKIE_KEY);
  return raw ? JSON.parse(raw) : {};
};

const writeApiKeys = (keys: Record<string, string>) => {
  Cookies.set(API_KEY_COOKIE_KEY, JSON.stringify(keys), { expires: 365 });
};

export default function LocalProvidersTab() {
  const { providers, updateProviderSettings } = useSettings();
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [editingBaseUrl, setEditingBaseUrl] = useState(false);
  const [editingApiKey, setEditingApiKey] = useState(false);
  const [editingModel, setEditingModel] = useState(false);
  const [tempBaseUrl, setTempBaseUrl] = useState('');
  const [tempApiKey, setTempApiKey] = useState('');
  const [tempModel, setTempModel] = useState('');
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);

  // Load saved values on mount
  useEffect(() => {
    const cfg = providers[PROVIDER_NAME] as IProviderConfig;
    const settings = cfg?.settings;

    // Load baseUrl from providerSettings, then fallback to cookie
    const savedBaseUrl = settings?.baseUrl || Cookies.get(BASE_URL_COOKIE_KEY) || '';
    setBaseUrl(savedBaseUrl);
    setTempBaseUrl(savedBaseUrl);

    // Load model from providerSettings, then fallback to cookie
    const savedModel = settings?.model || Cookies.get(MODEL_COOKIE_KEY) || '';
    setModel(savedModel);
    setTempModel(savedModel);

    // Load apiKey from providerSettings, then fallback to cookie
    const savedApiKey = settings?.apiKey || readApiKeys()[PROVIDER_NAME] || '';
    setApiKey(savedApiKey);
    setTempApiKey(savedApiKey);
  }, [providers]);

  // Ensure OpenAILike is enabled and LocalProvidersTab loads it
  useEffect(() => {
    if (providers && !providers[PROVIDER_NAME]) return;

    const cfg = providers[PROVIDER_NAME] as IProviderConfig;
    if (!cfg?.settings?.enabled) {
      updateProviderSettings(PROVIDER_NAME, {
        ...cfg?.settings,
        enabled: true,
        baseUrl: Cookies.get(BASE_URL_COOKIE_KEY) || cfg?.settings?.baseUrl || '',
        model: Cookies.get(MODEL_COOKIE_KEY) || cfg?.settings?.model || '',
      });
    }
  }, [providers, updateProviderSettings]);

  const handleSaveBaseUrl = useCallback(() => {
    const trimmed = tempBaseUrl.trim();
    setBaseUrl(trimmed);
    Cookies.set(BASE_URL_COOKIE_KEY, trimmed, { expires: 365 });

    // Also persist to provider settings store so LLM manager picks it up
    const cfg = providers[PROVIDER_NAME] as IProviderConfig;
    updateProviderSettings(PROVIDER_NAME, {
      ...cfg?.settings,
      baseUrl: trimmed,
    });

    setEditingBaseUrl(false);
    setConnectionStatus('idle');
    toast('Base URL saved');
  }, [tempBaseUrl, providers, updateProviderSettings, toast]);

  const handleSaveApiKey = useCallback(() => {
    const trimmed = tempApiKey.trim();
    setApiKey(trimmed);
    const keys = readApiKeys();
    keys[PROVIDER_NAME] = trimmed;
    writeApiKeys(keys);

    // Also persist to provider settings store so LLM manager picks it up
    const cfg = providers[PROVIDER_NAME] as IProviderConfig;
    updateProviderSettings(PROVIDER_NAME, {
      ...cfg?.settings,
      apiKey: trimmed,
    });

    setEditingApiKey(false);
    setConnectionStatus('idle');
    toast('API Key saved');
  }, [tempApiKey, providers, updateProviderSettings, toast]);

  const handleSaveModel = useCallback(() => {
    const trimmed = tempModel.trim();
    setModel(trimmed);
    Cookies.set(MODEL_COOKIE_KEY, trimmed, { expires: 365 });

    // Also persist to provider settings store so LLM manager picks it up
    const cfg = providers[PROVIDER_NAME] as IProviderConfig;
    updateProviderSettings(PROVIDER_NAME, {
      ...cfg?.settings,
      model: trimmed,
    });

    setEditingModel(false);
    toast('Model saved');
  }, [tempModel, providers, updateProviderSettings, toast]);

  const handleToggle = (enabled: boolean) => {
    const cfg = providers[PROVIDER_NAME] as IProviderConfig;
    updateProviderSettings(PROVIDER_NAME, { ...cfg?.settings, enabled });
    toast(enabled ? 'OpenAI Compatible enabled' : 'OpenAI Compatible disabled');
  };

  const handleTestConnection = useCallback(async () => {
    if (!baseUrl || !apiKey) {
      toast('Please enter Base URL and API Key first');
      return;
    }

    setIsTesting(true);
    setConnectionStatus('idle');
    setConnectionMessage('');

    try {
      const provider = new OpenAILikeProvider();
      const result: TestConnectionResult = await provider.testConnection(baseUrl, apiKey, model);

      if (result.success) {
        setConnectionStatus('success');
        if (result.errorCode === 'MODEL_NOT_FOUND') {
          setConnectionMessage(result.error || 'Connection successful but model not found');
        } else {
          setConnectionMessage('Connection successful!');
        }
        if (result.models) {
          setAvailableModels(result.models);
        }
        toast.success('Connection successful!');
      } else {
        setConnectionStatus('error');
        setConnectionMessage(result.error || 'Connection failed');
        toast.error(result.error || 'Connection failed');
      }
    } catch (err: any) {
      setConnectionStatus('error');
      setConnectionMessage(err.message || 'Connection failed');
      toast.error('Connection test failed');
    } finally {
      setIsTesting(false);
    }
  }, [baseUrl, apiKey, model, toast]);

  const handleFetchModels = useCallback(async () => {
    if (!baseUrl || !apiKey) {
      toast('Please enter Base URL and API Key first');
      return;
    }

    setIsFetchingModels(true);
    setAvailableModels([]);

    try {
      // Clean up base URL
      let cleanBaseUrl = baseUrl.trim();
      if (cleanBaseUrl.endsWith('/')) {
        cleanBaseUrl = cleanBaseUrl.slice(0, -1);
      }

      const response = await fetch(`${cleanBaseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          toast.error('Unauthorized - Invalid API Key');
        } else if (response.status === 404) {
          toast.error('Models endpoint not found');
        } else {
          toast.error(`Error: ${response.status}`);
        }
        return;
      }

      const res = (await response.json()) as ModelsResponse;
      const models: string[] = [];

      if (res.data && Array.isArray(res.data)) {
        models.push(...res.data.map((m) => m.id));
      }

      setAvailableModels(models);

      if (models.length === 0) {
        toast.warning('No models found');
      } else {
        toast.success(`Found ${models.length} models`);
      }
    } catch (err: any) {
      toast.error('Failed to fetch models');
    } finally {
      setIsFetchingModels(false);
    }
  }, [baseUrl, apiKey, toast]);

  const handleSelectModel = useCallback(
    (modelId: string) => {
      setTempModel(modelId);
      setModel(modelId);
      Cookies.set(MODEL_COOKIE_KEY, modelId, { expires: 365 });

      const cfg = providers[PROVIDER_NAME] as IProviderConfig;
      updateProviderSettings(PROVIDER_NAME, {
        ...cfg?.settings,
        model: modelId,
      });

      setEditingModel(false);
      toast(`Model set to: ${modelId}`);
    },
    [providers, updateProviderSettings, toast],
  );

  const isEnabled = (() => {
    const cfg = providers[PROVIDER_NAME] as IProviderConfig;
    return cfg?.settings?.enabled ?? true;
  })();

  return (
    <div
      className={classNames(
        'rounded-lg bg-bolt-elements-background text-bolt-elements-textPrimary shadow-sm p-4',
        'hover:bg-bolt-elements-background-depth-2',
        'transition-all duration-200',
      )}
      role="region"
      aria-label="OpenAI Compatible Provider"
    >
      <motion.div
        className="space-y-6"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-bolt-elements-borderColor pb-4">
          <div className="flex items-center gap-3">
            <motion.div
              className={classNames(
                'w-10 h-10 flex items-center justify-center rounded-xl',
                'bg-purple-500/10 text-purple-500',
              )}
              whileHover={{ scale: 1.05 }}
            >
              <BiCodeBlock className="w-6 h-6" />
            </motion.div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-bolt-elements-textPrimary">OpenAI Compatible</h2>
              </div>
              <p className="text-sm text-bolt-elements-textSecondary">Connect to any OpenAI-compatible API endpoint</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-bolt-elements-textSecondary">Enabled</span>
            <Switch checked={isEnabled} onCheckedChange={handleToggle} aria-label="Toggle OpenAI Compatible provider" />
          </div>
        </div>

        {/* Fields */}
        <div className="space-y-4">
          {/* Base URL */}
          <div>
            <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-2">Base URL</label>
            {editingBaseUrl ? (
              <div className="flex gap-2">
                <input
                  type="text"
                  value={tempBaseUrl}
                  onChange={(e) => setTempBaseUrl(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className={classNames(
                    'flex-1 px-3 py-2 rounded-lg text-sm',
                    'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                    'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveBaseUrl();
                    if (e.key === 'Escape') setEditingBaseUrl(false);
                  }}
                  autoFocus
                />
                <button
                  onClick={handleSaveBaseUrl}
                  className="px-3 py-2 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors text-sm"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingBaseUrl(false);
                    setTempBaseUrl(baseUrl);
                  }}
                  className="px-3 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                onClick={() => setEditingBaseUrl(true)}
                className={classNames(
                  'w-full px-3 py-2 rounded-lg text-sm cursor-pointer',
                  'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                  'hover:border-purple-500/30',
                  'transition-all duration-200',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="i-ph:link text-sm text-bolt-elements-textSecondary" />
                  <span className={baseUrl ? 'text-bolt-elements-textPrimary' : 'text-bolt-elements-textTertiary'}>
                    {baseUrl || 'Click to set Base URL'}
                  </span>
                </div>
              </div>
            )}
            <p className="text-xs text-bolt-elements-textTertiary mt-1">
              e.g., https://api.example.com/v1 or https://openai.example.com
            </p>
          </div>

          {/* API Key */}
          <div>
            <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-2">API Key</label>
            {editingApiKey ? (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={tempApiKey}
                  onChange={(e) => setTempApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={classNames(
                    'flex-1 px-3 py-2 rounded-lg text-sm',
                    'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                    'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                  )}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSaveApiKey();
                    if (e.key === 'Escape') setEditingApiKey(false);
                  }}
                  autoFocus
                />
                <button
                  onClick={handleSaveApiKey}
                  className="px-3 py-2 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors text-sm"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setEditingApiKey(false);
                    setTempApiKey(apiKey);
                  }}
                  className="px-3 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div
                onClick={() => setEditingApiKey(true)}
                className={classNames(
                  'w-full px-3 py-2 rounded-lg text-sm cursor-pointer',
                  'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                  'hover:border-purple-500/30',
                  'transition-all duration-200',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="i-ph:key text-sm text-bolt-elements-textSecondary" />
                  <span className={apiKey ? 'text-bolt-elements-textPrimary' : 'text-bolt-elements-textTertiary'}>
                    {apiKey ? '••••••••••••••••••••••••' : 'Click to set API Key'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Model ID */}
          <div>
            <label className="block text-sm font-medium text-bolt-elements-textSecondary mb-2">Model</label>
            {editingModel ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={tempModel}
                    onChange={(e) => setTempModel(e.target.value)}
                    placeholder="gpt-4, deepseek-chat, qwen3-coder, etc."
                    className={classNames(
                      'flex-1 px-3 py-2 rounded-lg text-sm',
                      'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                      'text-bolt-elements-textPrimary placeholder-bolt-elements-textTertiary',
                      'focus:outline-none focus:ring-2 focus:ring-purple-500/30',
                    )}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveModel();
                      if (e.key === 'Escape') setEditingModel(false);
                    }}
                    autoFocus
                  />
                  <button
                    onClick={handleSaveModel}
                    className="px-3 py-2 rounded-lg bg-green-500/10 text-green-500 hover:bg-green-500/20 transition-colors text-sm"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setEditingModel(false);
                      setTempModel(model);
                    }}
                    className="px-3 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
                {availableModels.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-bolt-elements-borderColor">
                    {availableModels.map((m) => (
                      <button
                        key={m}
                        onClick={() => handleSelectModel(m)}
                        className={classNames(
                          'w-full text-left px-3 py-2 text-sm hover:bg-purple-500/10 transition-colors',
                          m === model ? 'bg-purple-500/20 text-purple-500' : 'text-bolt-elements-textPrimary',
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div
                onClick={() => setEditingModel(true)}
                className={classNames(
                  'w-full px-3 py-2 rounded-lg text-sm cursor-pointer',
                  'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                  'hover:border-purple-500/30',
                  'transition-all duration-200',
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="i-ph:robot text-sm text-bolt-elements-textSecondary" />
                  <span className={model ? 'text-bolt-elements-textPrimary' : 'text-bolt-elements-textTertiary'}>
                    {model || 'Click to set Model ID'}
                  </span>
                </div>
              </div>
            )}
            <p className="text-xs text-bolt-elements-textTertiary mt-1">Enter any OpenAI-compatible model ID</p>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={handleTestConnection}
              disabled={isTesting || !baseUrl || !apiKey}
              className={classNames(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                isTesting || !baseUrl || !apiKey
                  ? 'bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary cursor-not-allowed'
                  : 'bg-purple-500/10 text-purple-500 hover:bg-purple-500/20',
              )}
            >
              {isTesting ? <span className="i-ph:circle-notch animate-spin" /> : <BiCheck className="w-4 h-4" />}
              {isTesting ? 'Testing...' : 'Test Connection'}
            </button>

            <button
              onClick={handleFetchModels}
              disabled={isFetchingModels || !baseUrl || !apiKey}
              className={classNames(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors',
                isFetchingModels || !baseUrl || !apiKey
                  ? 'bg-bolt-elements-background-depth-3 text-bolt-elements-textTertiary cursor-not-allowed'
                  : 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20',
              )}
            >
              {isFetchingModels ? (
                <span className="i-ph:circle-notch animate-spin" />
              ) : (
                <BiRefresh className="w-4 h-4" />
              )}
              {isFetchingModels ? 'Fetching...' : 'Fetch Models'}
            </button>
          </div>

          {/* Connection Status */}
          {connectionStatus !== 'idle' && (
            <div
              className={classNames(
                'p-3 rounded-lg text-sm',
                connectionStatus === 'success'
                  ? 'bg-green-500/10 text-green-500 border border-green-500/20'
                  : 'bg-red-500/10 text-red-500 border border-red-500/20',
              )}
            >
              <div className="flex items-center gap-2">
                {connectionStatus === 'success' ? <BiCheck className="w-4 h-4" /> : <BiX className="w-4 h-4" />}
                <span>{connectionMessage}</span>
              </div>
            </div>
          )}

          {/* Available Models */}
          {availableModels.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-bolt-elements-textSecondary">
                  Available Models ({availableModels.length})
                </label>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-3">
                {availableModels.map((m) => (
                  <button
                    key={m}
                    onClick={() => handleSelectModel(m)}
                    className={classNames(
                      'w-full text-left px-3 py-2 text-sm hover:bg-purple-500/10 transition-colors',
                      'border-b border-bolt-elements-borderColor last:border-b-0',
                      m === model ? 'bg-purple-500/20 text-purple-500' : 'text-bolt-elements-textPrimary',
                    )}
                  >
                    <span className="flex items-center justify-between">
                      <span>{m}</span>
                      {m === model && <BiCheck className="w-4 h-4 text-purple-500" />}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Status indicator */}
          <div className="flex items-center gap-3 pt-1 border-t border-bolt-elements-borderColor">
            {apiKey ? (
              <>
                <span className="i-ph:check-circle-fill text-green-500 text-sm" />
                <span className="text-xs text-green-500">API Key configured</span>
              </>
            ) : (
              <>
                <span className="i-ph:x-circle-fill text-red-500 text-sm" />
                <span className="text-xs text-red-500">API Key not set</span>
              </>
            )}
            {baseUrl && (
              <>
                <span className="i-ph:check-circle-fill text-green-500 text-sm ml-2" />
                <span className="text-xs text-green-500">Base URL configured</span>
              </>
            )}
            {model && (
              <>
                <span className="i-ph:check-circle-fill text-green-500 text-sm ml-2" />
                <span className="text-xs text-green-500">Model: {model}</span>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
