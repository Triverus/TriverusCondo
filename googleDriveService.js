import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Escopo estrito e somente leitura da API do Google Drive
 */
export const GOOGLE_DRIVE_READONLY_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
export const GOOGLE_OAUTH2_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3';

// Margem preventiva de expiração do token de acesso em cache (5 minutos)
const TOKEN_EXPIRY_BUFFER_SECONDS = 300;

let cachedEnv = null;
function getEnvValue(key) {
  if (process.env[key]) {
    return process.env[key].trim();
  }
  if (!cachedEnv) {
    cachedEnv = {};
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      try {
        const content = fs.readFileSync(envPath, 'utf8');
        content.split('\n').forEach((line) => {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const idx = trimmed.indexOf('=');
            if (idx > 0) {
              const k = trimmed.slice(0, idx).trim();
              const v = trimmed.slice(idx + 1).trim();
              cachedEnv[k] = v;
            }
          }
        });
      } catch {}
    }
  }
  return (cachedEnv[key] || '').trim();
}

/**
 * Normaliza a chave privada RSA fornecida via variável de ambiente.
 * Remove aspas envolventes e converte caracteres literais '\n' em quebras de linha reais.
 */
export function normalizePrivateKey(rawKey) {
  if (!rawKey) return '';
  let key = rawKey.trim();
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }
  key = key.replace(/\\n/g, '\n');
  return key.trim();
}

/**
 * Mascara strings sensíveis ou identificadores longos para logs e diagnósticos seguros.
 */
export function maskIdentifier(value, isEmail = false) {
  if (!value) return null;
  const clean = value.trim();
  if (isEmail) {
    const parts = clean.split('@');
    if (parts.length === 2) {
      const user = parts[0];
      const domain = parts[1];
      const maskedUser = user.length > 3 ? `${user.slice(0, 3)}***` : `${user[0]}***`;
      return `${maskedUser}@${domain}`;
    }
  }
  if (clean.length <= 8) {
    return '***';
  }
  return `${clean.slice(0, 4)}***${clean.slice(-4)}`;
}

/**
 * Valida a sintaxe e a decodificação da chave privada usando a biblioteca nativa crypto do Node.js.
 */
export function validatePrivateKeySyntax(normalizedKey) {
  if (!normalizedKey) {
    return { valid: false, type: null, error: 'Chave privada não fornecida.' };
  }

  const isPkcs8 = normalizedKey.includes('-----BEGIN PRIVATE KEY-----');
  const isPkcs1 = normalizedKey.includes('-----BEGIN RSA PRIVATE KEY-----');

  if (!isPkcs8 && !isPkcs1) {
    return {
      valid: false,
      type: null,
      error: 'Formato inválido. A chave deve conter cabeçalho -----BEGIN PRIVATE KEY----- ou -----BEGIN RSA PRIVATE KEY-----.',
    };
  }

  try {
    crypto.createPrivateKey({
      key: normalizedKey,
      format: 'pem',
    });
    return {
      valid: true,
      type: isPkcs8 ? 'PKCS#8' : 'PKCS#1 (RSA)',
    };
  } catch (err) {
    return {
      valid: false,
      type: isPkcs8 ? 'PKCS#8' : 'PKCS#1 (RSA)',
      error: `Falha ao processar chave RSA: ${err?.message || 'Formato PEM corrompido'}`,
    };
  }
}

/**
 * Retorna o status de configuração das variáveis do Google Drive central.
 * NUNCA expõe a chave privada ou tokens.
 */
export function getGoogleDriveConfigStatus() {
  const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL');
  const rawKey = getEnvValue('GOOGLE_DRIVE_PRIVATE_KEY');
  const rootFolderId = getEnvValue('GOOGLE_DRIVE_ROOT_FOLDER_ID');

  const normalizedKey = normalizePrivateKey(rawKey);
  const keyValidation = validatePrivateKeySyntax(normalizedKey);

  const missing = [];
  if (!email) missing.push('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL');
  if (!rawKey) missing.push('GOOGLE_DRIVE_PRIVATE_KEY');
  if (!rootFolderId) missing.push('GOOGLE_DRIVE_ROOT_FOLDER_ID');

  const configured = missing.length === 0 && keyValidation.valid;

  return {
    configured,
    has_service_account_email: Boolean(email),
    service_account_email_masked: maskIdentifier(email, true),
    has_private_key: Boolean(rawKey),
    private_key_format_valid: keyValidation.valid,
    private_key_type: keyValidation.type,
    has_root_folder_id: Boolean(rootFolderId),
    root_folder_id_masked: maskIdentifier(rootFolderId, false),
    missing_variables: missing,
  };
}

let memoryTokenCache = null;

export function clearDriveTokenCache() {
  memoryTokenCache = null;
}

/**
 * Obtém um token de acesso de leitura para o Google Drive via OAuth2 Service Account JWT Bearer.
 */
export async function getDriveServiceAccountAccessToken(options) {
  const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL');
  const rawKey = getEnvValue('GOOGLE_DRIVE_PRIVATE_KEY');
  const normalizedKey = normalizePrivateKey(rawKey);

  if (!email || !normalizedKey) {
    const status = getGoogleDriveConfigStatus();
    throw new Error(
      `Credenciais do Google Drive incompletas. Variáveis ausentes: ${status.missing_variables.join(', ')}`
    );
  }

  const keyValidation = validatePrivateKeySyntax(normalizedKey);
  if (!keyValidation.valid) {
    throw new Error(
      `Chave privada da Conta de Serviço inválida: ${keyValidation.error || 'formato PEM incompatível'}`
    );
  }

  const now = Math.floor(Date.now() / 1000);

  if (!options?.forceRefresh && memoryTokenCache) {
    if (Date.now() < memoryTokenCache.expiresAt) {
      return memoryTokenCache.accessToken;
    }
  }

  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const payload = {
    iss: email,
    scope: GOOGLE_DRIVE_READONLY_SCOPE,
    aud: GOOGLE_OAUTH2_TOKEN_URL,
    exp: now + 3600,
    iat: now,
  };

  const encodedHeader = Buffer.from(JSON.stringify(header)).toString('base64url');
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const unsignedToken = `${encodedHeader}.${encodedPayload}`;

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedToken);
  signer.end();
  const signature = signer.sign(normalizedKey, 'base64url');
  const jwt = `${unsignedToken}.${signature}`;

  const bodyParams = new URLSearchParams();
  bodyParams.append('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  bodyParams.append('assertion', jwt);

  const tokenResponse = await fetch(GOOGLE_OAUTH2_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: bodyParams.toString(),
  });

  if (!tokenResponse.ok) {
    let errorDetails = '';
    try {
      const errJson = await tokenResponse.json();
      errorDetails = errJson.error_description || errJson.error || JSON.stringify(errJson);
    } catch {
      errorDetails = await tokenResponse.text();
    }

    memoryTokenCache = null;

    throw new Error(
      `Falha na autenticação da Conta de Serviço Google (${tokenResponse.status}): ${errorDetails}`
    );
  }

  const tokenData = await tokenResponse.json();
  const accessToken = tokenData.access_token;
  const expiresInSeconds = Number(tokenData.expires_in) || 3600;

  const safeLifetimeMs = Math.max(60, expiresInSeconds - TOKEN_EXPIRY_BUFFER_SECONDS) * 1000;
  memoryTokenCache = {
    accessToken,
    expiresAt: Date.now() + safeLifetimeMs,
  };

  return accessToken;
}

/**
 * Consulta e valida se a pasta raiz configurada existe e pode ser lida.
 */
export async function verifyRootFolder() {
  const rootFolderId = getEnvValue('GOOGLE_DRIVE_ROOT_FOLDER_ID');
  if (!rootFolderId) {
    throw new Error('GOOGLE_DRIVE_ROOT_FOLDER_ID não está configurado.');
  }

  const accessToken = await getDriveServiceAccountAccessToken();

  const url = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(
    rootFolderId
  )}?fields=id,name,mimeType,trashed&supportsAllDrives=true`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (res.status === 404) {
    throw new Error(
      `Pasta raiz (${maskIdentifier(
        rootFolderId
      )}) não encontrada. Certifique-se de que o ID está correto e de que a pasta foi compartilhada no Google Drive com o e-mail da conta de serviço.`
    );
  }

  if (res.status === 403) {
    let detail = '';
    try {
      const errJson = await res.json();
      detail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      detail = await res.text();
    }
    throw new Error(
      `Acesso negado à pasta raiz (${res.status}): ${detail}. Verifique as permissões de compartilhamento da pasta e se a Google Drive API está habilitada no projeto do Google Cloud.`
    );
  }

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`Erro ao consultar pasta raiz (${res.status}): ${errorText}`);
  }

  const fileData = await res.json();

  if (fileData.trashed) {
    throw new Error(`A pasta raiz configurada (${fileData.name || rootFolderId}) está na lixeira do Google Drive.`);
  }

  if (fileData.mimeType !== 'application/vnd.google-apps.folder') {
    throw new Error(
      `O identificador configurado (${fileData.name}) não é uma pasta do Google Drive (tipo: ${fileData.mimeType}).`
    );
  }

  return {
    id: fileData.id,
    name: fileData.name,
    mimeType: fileData.mimeType,
  };
}

/**
 * Lista exclusivamente as subpastas imediatas pertencentes à pasta raiz configurada.
 */
export async function listImmediateSubfolders() {
  const root = await verifyRootFolder();
  const accessToken = await getDriveServiceAccountAccessToken();

  const query = `'${root.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,mimeType,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    let errorDetail = '';
    try {
      const errJson = await res.json();
      errorDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errorDetail = await res.text();
    }
    throw new Error(`Falha ao listar subpastas da pasta raiz (${res.status}): ${errorDetail}`);
  }

  const data = await res.json();
  const subfolders = (data.files || []).map((f) => ({
    id: f.id,
    name: f.name,
    mimeType: f.mimeType,
    createdTime: f.createdTime,
    modifiedTime: f.modifiedTime,
  }));

  return {
    rootFolder: {
      id: root.id,
      name: root.name,
    },
    subfolders,
  };
}

/**
 * Executa um diagnóstico completo e seguro da conexão com o Google Drive central.
 */
export async function diagnoseDriveConnection() {
  const status = getGoogleDriveConfigStatus();

  if (!status.configured) {
    return {
      success: false,
      stage: 'config',
      configured: false,
      error: {
        code: 'MISSING_OR_INVALID_CONFIG',
        message: 'Configuração do Google Drive incompleta ou inválida no servidor.',
        resolution_hint: `Configure as seguintes variáveis de ambiente no servidor: ${status.missing_variables.join(
          ', '
        )}${!status.private_key_format_valid && status.has_private_key ? ' (A chave privada precisa ser um PEM RSA válido)' : ''}.`,
      },
    };
  }

  try {
    await getDriveServiceAccountAccessToken({ forceRefresh: true });
  } catch (authErr) {
    return {
      success: false,
      stage: 'oauth_token',
      configured: true,
      error: {
        code: 'AUTH_FAILED',
        message: authErr?.message || 'Falha ao autenticar Conta de Serviço com o Google OAuth2.',
        resolution_hint:
          'Verifique se a GOOGLE_DRIVE_PRIVATE_KEY pertence à GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL e se o serviço de relógio do servidor está sincronizado.',
      },
    };
  }

  let rootInfo;
  try {
    rootInfo = await verifyRootFolder();
  } catch (rootErr) {
    return {
      success: false,
      stage: 'root_folder',
      configured: true,
      error: {
        code: 'ROOT_FOLDER_ACCESS_DENIED_OR_NOT_FOUND',
        message: rootErr?.message || 'Não foi possível acessar a pasta raiz configurada.',
        resolution_hint: `Abra a pasta no Google Drive central (da conta plataformatriverus@gmail.com), clique em 'Compartilhar' e adicione o e-mail da conta de serviço (${status.service_account_email_masked}) com permissão de 'Leitor' (Viewer). Certifique-se também de que a 'Google Drive API' está ativada no Google Cloud Console.`,
      },
    };
  }

  try {
    const listResult = await listImmediateSubfolders();
    return {
      success: true,
      stage: 'subfolders',
      configured: true,
      root_folder: {
        id: rootInfo.id,
        name: rootInfo.name,
      },
      subfolders_count: listResult.subfolders.length,
      subfolders_sample: listResult.subfolders.slice(0, 10),
    };
  } catch (listErr) {
    return {
      success: false,
      stage: 'subfolders',
      configured: true,
      root_folder: {
        id: rootInfo.id,
        name: rootInfo.name,
      },
      error: {
        code: 'SUBFOLDERS_LIST_FAILED',
        message: listErr?.message || 'Falha ao consultar as subpastas da pasta raiz.',
        resolution_hint:
          'Verifique se a conta de serviço possui permissão de leitura nos itens contidos na pasta raiz.',
      },
    };
  }
}

/**
 * Normaliza um nome removendo acentos, pontuação, múltiplos espaços e convertendo para minúsculas.
 */
export function normalizeNameForMatching(name) {
  if (!name) return '';
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Remove prefixos comuns de condomínios para comparação flexível.
 */
export function stripCondoPrefix(normalizedName) {
  return normalizedName
    .replace(/^(condominio|cond|edificio|edif|ed|residencial|res|conjunto|cj)\s+/i, '')
    .trim();
}

/**
 * Localiza a subpasta correspondente ao condomínio dentro da pasta raiz do Drive.
 */
export async function findCondoSubfolder(condoName) {
  const cleanCondoName = (condoName || '').trim();
  if (!cleanCondoName) {
    return {
      found: false,
      folder: null,
      searched_name: condoName,
      normalized_searched_name: '',
      error: 'Nome do condomínio não informado.',
      total_subfolders_scanned: 0,
    };
  }

  const { subfolders } = await listImmediateSubfolders();
  const normalizedCondo = normalizeNameForMatching(cleanCondoName);
  const strippedCondo = stripCondoPrefix(normalizedCondo);

  const exactMatches = subfolders.filter((folder) => {
    const norm = normalizeNameForMatching(folder.name);
    return norm === normalizedCondo;
  });

  if (exactMatches.length === 1) {
    return {
      found: true,
      folder: exactMatches[0],
      searched_name: cleanCondoName,
      normalized_searched_name: normalizedCondo,
      total_subfolders_scanned: subfolders.length,
    };
  }

  if (exactMatches.length > 1) {
    return {
      found: false,
      folder: null,
      searched_name: cleanCondoName,
      normalized_searched_name: normalizedCondo,
      error: `Foram encontradas múltiplas pastas com nomes idênticos no Google Drive (${exactMatches.map((f) => f.name).join(', ')}). Ajuste o nome da pasta no Drive para evitar ambiguidade.`,
      total_subfolders_scanned: subfolders.length,
    };
  }

  const prefixMatches = subfolders.filter((folder) => {
    const norm = normalizeNameForMatching(folder.name);
    const stripped = stripCondoPrefix(norm);
    return stripped === strippedCondo && stripped.length >= 3;
  });

  if (prefixMatches.length === 1) {
    return {
      found: true,
      folder: prefixMatches[0],
      searched_name: cleanCondoName,
      normalized_searched_name: normalizedCondo,
      total_subfolders_scanned: subfolders.length,
    };
  }

  if (prefixMatches.length > 1) {
    return {
      found: false,
      folder: null,
      searched_name: cleanCondoName,
      normalized_searched_name: normalizedCondo,
      error: `Mais de uma pasta corresponde ao condomínio sem prefixo (${prefixMatches.map((f) => f.name).join(', ')}). Nomeie a pasta exatamente como o condomínio para garantir o vínculo correto.`,
      total_subfolders_scanned: subfolders.length,
    };
  }

  return {
    found: false,
    folder: null,
    searched_name: cleanCondoName,
    normalized_searched_name: normalizedCondo,
    total_subfolders_scanned: subfolders.length,
  };
}

/**
 * Lista exclusivamente os arquivos PDF válidos contidos em uma pasta do Drive.
 */
export async function listPdfFilesInFolder(folderId) {
  if (!folderId) {
    throw new Error('Identificador da pasta do condomínio não informado.');
  }

  const accessToken = await getDriveServiceAccountAccessToken();

  const query = `'${folderId}' in parents and trashed = false`;
  const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(
    query
  )}&fields=files(id,name,mimeType,size,modifiedTime,createdTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    let errDetail = '';
    try {
      const errJson = await res.json();
      errDetail = errJson.error?.message || JSON.stringify(errJson);
    } catch {
      errDetail = await res.text();
    }
    throw new Error(`Falha ao listar arquivos da pasta (${res.status}): ${errDetail}`);
  }

  const data = await res.json();
  const rawFiles = data.files || [];

  const pdfFiles = rawFiles
    .filter((f) => {
      const isPdfMime = f.mimeType === 'application/pdf';
      const isPdfName = typeof f.name === 'string' && f.name.toLowerCase().endsWith('.pdf');
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder';
      return (isPdfMime || isPdfName) && !isFolder;
    })
    .map((f) => ({
      id: f.id,
      name: f.name,
      mimeType: f.mimeType || 'application/pdf',
      size: f.size ? Number(f.size) : null,
      modifiedTime: f.modifiedTime || null,
      createdTime: f.createdTime || null,
    }));

  return pdfFiles;
}

/**
 * Obtém o stream binário de um arquivo PDF no Google Drive para visualização segura e autenticada.
 */
export async function getDriveFileStream(fileId) {
  if (!fileId) {
    throw new Error('ID do arquivo não informado.');
  }

  const accessToken = await getDriveServiceAccountAccessToken();
  const url = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`;

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!res.ok) {
    throw new Error(`Falha ao recuperar arquivo do Google Drive (${res.status})`);
  }

  return res;
}



export async function listAvailableFoldersForCondo(condoName) {
  const matchResult = await findCondoSubfolder(condoName);
  if (!matchResult.found || !matchResult.folder) {
    return {
      condo_found: false,
      condo_folder: null,
      folders: [],
      error: matchResult.error || `Pasta do condomínio "${condoName}" não encontrada no Google Drive central.`,
    };
  }

  const condoFolder = matchResult.folder;
  const accessToken = await getDriveServiceAccountAccessToken();
  const folders = [];

  // 1. Incluir a própria pasta do condomínio como opção principal
  folders.push({
    id: condoFolder.id,
    name: condoFolder.name,
    path: condoFolder.name,
    is_condo_root: true,
    createdTime: condoFolder.createdTime,
    modifiedTime: condoFolder.modifiedTime,
  });

  // 2. Buscar subpastas imediatas dentro da pasta do condomínio
  try {
    const query = `'${condoFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(
      query
    )}&fields=files(id,name,mimeType,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;

    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.ok) {
      const data = await res.json();
      const subfolders = data.files || [];
      for (const sf of subfolders) {
        folders.push({
          id: sf.id,
          name: sf.name,
          path: `${condoFolder.name} / ${sf.name}`,
          is_condo_root: false,
          createdTime: sf.createdTime,
          modifiedTime: sf.modifiedTime,
        });

        // 3. Buscar subpastas aninhadas (nível 2)
        try {
          const nestedQuery = `'${sf.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
          const nestedUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(
            nestedQuery
          )}&fields=files(id,name,mimeType,createdTime,modifiedTime)&orderBy=name&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`;

          const nestedRes = await fetch(nestedUrl, {
            method: 'GET',
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (nestedRes.ok) {
            const nestedData = await nestedRes.json();
            for (const nsf of nestedData.files || []) {
              folders.push({
                id: nsf.id,
                name: nsf.name,
                path: `${condoFolder.name} / ${sf.name} / ${nsf.name}`,
                is_condo_root: false,
                createdTime: nsf.createdTime,
                modifiedTime: nsf.modifiedTime,
              });
            }
          }
        } catch {
          // Ignorar erro no segundo nível
        }
      }
    }
  } catch (err) {
    console.warn('[DRIVE_SUBFOLDERS_FETCH_ERROR]', err?.message || err);
  }

  // 4. Preencher contagem de PDFs para as pastas encontradas
  for (const f of folders) {
    try {
      const pdfs = await listPdfFilesInFolder(f.id);
      f.pdf_count = pdfs.length;
    } catch {
      f.pdf_count = 0;
    }
  }

  return {
    condo_found: true,
    condo_folder: condoFolder,
    folders,
  };
}



/**
 * Valida se uma pasta existe e está acessível no Google Drive pela conta de serviço.
 */
export async function verifyFolderAccessibleInDrive(folderId) {
  if (!folderId || !String(folderId).trim()) {
    return { accessible: false, error: 'Identificador da pasta não informado.' };
  }
  try {
    const accessToken = await getDriveServiceAccountAccessToken();
    const cleanId = String(folderId).trim();
    const url = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(cleanId)}?fields=id,name,mimeType,trashed&supportsAllDrives=true`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (res.status === 404) {
      return {
        accessible: false,
        error: `A pasta selecionada (${cleanId}) não foi encontrada no Google Drive ou não foi compartilhada com a integração.`,
      };
    }
    if (res.status === 403) {
      const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL') || 'conta de serviço do Triverus';
      return {
        accessible: false,
        error: `Acesso negado à pasta no Google Drive (${res.status}). Compartilhe a pasta com o e-mail: ${email}.`,
      };
    }
    if (!res.ok) {
      return {
        accessible: false,
        error: `Erro ao verificar pasta no Google Drive (${res.status}).`,
      };
    }

    const data = await res.json();
    if (data.trashed) {
      return {
        accessible: false,
        error: `A pasta "${data.name}" está na lixeira do Google Drive.`,
      };
    }
    if (data.mimeType !== 'application/vnd.google-apps.folder') {
      return {
        accessible: false,
        error: `O item selecionado ("${data.name}") não é uma pasta do Google Drive.`,
      };
    }

    return {
      accessible: true,
      folder: { id: data.id, name: data.name },
    };
  } catch (err) {
    return {
      accessible: false,
      error: `Falha ao verificar pasta no Google Drive: ${err?.message || err}`,
    };
  }
}

/**
 * Navegação livre e hierárquica por QUALQUER pasta acessível no Google Drive.
 */
export async function getFolderContentsAndBreadcrumb(condoName, targetFolderId) {
  try {
    const root = await verifyRootFolder();
    const accessToken = await getDriveServiceAccountAccessToken();
    const reqFolderId = (targetFolderId && String(targetFolderId).trim()) ? String(targetFolderId).trim() : root.id;

    let activeFolder;
    const breadcrumb = [];

    if (reqFolderId === root.id) {
      activeFolder = { id: root.id, name: 'Google Drive' };
      breadcrumb.push({ id: root.id, name: 'Google Drive' });
    } else {
      const metaUrl = `${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(reqFolderId)}?fields=id,name,mimeType,parents,trashed&supportsAllDrives=true`;
      const metaRes = await fetch(metaUrl, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
      });

      if (metaRes.status === 404) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'A pasta solicitada não foi encontrada no Google Drive ou não foi compartilhada com a integração.',
        };
      }
      if (metaRes.status === 403) {
        const email = getEnvValue('GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL') || 'conta de serviço do Triverus';
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: `Acesso negado à pasta solicitada. Certifique-se de compartilhá-la com: ${email}.`,
        };
      }
      if (!metaRes.ok) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: `Erro ao consultar pasta no Google Drive (${metaRes.status}).`,
        };
      }

      const metaData = await metaRes.json();
      if (metaData.trashed) {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'A pasta selecionada está na lixeira do Google Drive.',
        };
      }
      if (metaData.mimeType !== 'application/vnd.google-apps.folder') {
        return {
          ok: false,
          currentFolder: { id: '', name: '' },
          breadcrumb: [],
          subfolders: [],
          pdfs: [],
          totalPdfsInCurrentFolder: 0,
          error: 'O item selecionado não é uma pasta do Google Drive.',
        };
      }

      activeFolder = { id: metaData.id, name: metaData.name };
      breadcrumb.unshift({ id: metaData.id, name: metaData.name });

      let currentParents = metaData.parents || [];
      let depth = 0;
      while (currentParents.length > 0 && depth < 10) {
        depth++;
        const pId = currentParents[0];
        if (pId === root.id) {
          breadcrumb.unshift({ id: root.id, name: 'Google Drive' });
          break;
        }
        try {
          const pRes = await fetch(`${GOOGLE_DRIVE_API_BASE}/files/${encodeURIComponent(pId)}?fields=id,name,parents,trashed&supportsAllDrives=true`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (pRes.ok) {
            const pData = await pRes.json();
            breadcrumb.unshift({ id: pData.id, name: pData.name });
            currentParents = pData.parents || [];
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      if (breadcrumb.length === 0 || breadcrumb[0].id !== root.id) {
        breadcrumb.unshift({ id: root.id, name: 'Google Drive' });
      }
    }

    const subQuery = `'${activeFolder.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const subUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(subQuery)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const subRes = await fetch(subUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const subData = subRes.ok ? await subRes.json() : { files: [] };
    const rawSubfolders = subData.files || [];

    const basePath = breadcrumb.map((b) => b.name).join(' / ');
    const currentPdfs = await listPdfFilesInFolder(activeFolder.id);

    const subfolders = await Promise.all(
      rawSubfolders.map(async (sf) => {
        let count = 0;
        try {
          const cQuery = `'${sf.id}' in parents and (mimeType = 'application/pdf' or name contains '.pdf') and trashed = false`;
          const cUrl = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(cQuery)}&fields=files(id)&pageSize=100&supportsAllDrives=true&includeItemsFromAllDrives=true`;
          const cRes = await fetch(cUrl, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          if (cRes.ok) {
            const cData = await cRes.json();
            count = (cData.files || []).length;
          }
        } catch {
          count = 0;
        }

        return {
          id: sf.id,
          name: sf.name,
          path: `${basePath} / ${sf.name}`,
          is_condo_root: false,
          pdf_count: count,
        };
      })
    );

    return {
      ok: true,
      currentFolder: activeFolder,
      breadcrumb,
      subfolders,
      pdfs: currentPdfs,
      totalPdfsInCurrentFolder: currentPdfs.length,
    };
  } catch (err) {
    return {
      ok: false,
      currentFolder: { id: '', name: '' },
      breadcrumb: [],
      subfolders: [],
      pdfs: [],
      totalPdfsInCurrentFolder: 0,
      error: `Falha ao navegar no Google Drive: ${err?.message || err}`,
    };
  }
}

/**
 * Busca de pastas em todo o Google Drive acessível à conta de serviço
 * (sem restrição à pasta TESTE ou raiz arbitrária).
 */
export async function searchDriveFolders(searchTerm) {
  try {
    const cleanTerm = (searchTerm || '').replace(/['\\]/g, '').trim();
    if (!cleanTerm) {
      return { ok: true, folders: [] };
    }
    const accessToken = await getDriveServiceAccountAccessToken();
    const q = `mimeType = 'application/vnd.google-apps.folder' and name contains '${cleanTerm}' and trashed = false`;
    const url = `${GOOGLE_DRIVE_API_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,modifiedTime)&orderBy=name&pageSize=50&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      return { ok: false, folders: [], error: `Erro na busca do Drive: ${res.status}` };
    }
    const data = await res.json();
    return {
      ok: true,
      folders: (data.files || []).map((f) => ({
        id: f.id,
        name: f.name,
      })),
    };
  } catch (err) {
    return { ok: false, folders: [], error: err?.message || String(err) };
  }
}

