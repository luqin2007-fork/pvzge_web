/**
 * Cloudflare Worker - S3 OSS Proxy for PvZ2 Gardendless
 *
 * Proxies requests to an S3-compatible object storage backend.
 * Supports both public and authenticated (AWS Signature V4) access.
 *
 * Environment variables (set in wrangler.toml or Cloudflare dashboard):
 *   S3_ENDPOINT  - S3 service URL, e.g. https://s3.hi168.com
 *   S3_BUCKET    - Bucket name, e.g. hi168-32227-8062svww
 *   S3_REGION    - Region string for signing (default: us-east-1)
 *   S3_ACCESS_KEY_ID     - (optional) Access Key for signed requests
 *   S3_SECRET_ACCESS_KEY - (optional) Secret Key for signed requests
 *   CACHE_TTL    - Cache-Control max-age in seconds (default: 86400)
 */

// MIME type mapping
const MIME_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  mp4: 'video/mp4',
  webm: 'video/webm',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  otf: 'font/otf',
  eot: 'application/vnd.ms-fontobject',
  wasm: 'application/wasm',
  bin: 'application/octet-stream',
  pvr: 'application/octet-stream',
  pkm: 'application/octet-stream',
  astc: 'application/octet-stream',
  cconb: 'application/octet-stream',
  xml: 'application/xml',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
};

/**
 * Get MIME type from file extension
 */
function getMimeType(path) {
  const ext = path.split('.').pop().toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

/**
 * AWS Signature V4 signing helpers
 */
async function hmacSha256(key, message) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    typeof key === 'string' ? new TextEncoder().encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return new Uint8Array(
    await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message))
  );
}

async function sha256Hex(data) {
  const buffer = await crypto.subtle.digest(
    'SHA-256',
    typeof data === 'string' ? new TextEncoder().encode(data) : data
  );
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sign a request using AWS Signature V4
 */
async function signRequest(method, url, headers, body, env) {
  const accessKeyId = env.S3_ACCESS_KEY_ID;
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY;
  const region = env.S3_REGION || 'us-east-1';
  const service = 's3';

  const parsedUrl = new URL(url);
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const shortDate = dateStamp.slice(0, 8);

  const payloadHash = await sha256Hex(body || '');

  // Build canonical headers
  const signedHeaders = ['host', 'x-amz-content-sha256', 'x-amz-date'];
  const canonicalHeaders = [
    `host:${parsedUrl.host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${dateStamp}`,
  ].join('\n') + '\n';

  // Build canonical request
  const canonicalRequest = [
    method,
    parsedUrl.pathname,
    parsedUrl.search ? parsedUrl.search.slice(1) : '',
    canonicalHeaders,
    signedHeaders.join(';'),
    payloadHash,
  ].join('\n');

  // Build string to sign
  const credentialScope = `${shortDate}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    dateStamp,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  // Calculate signature
  const signingKey = await hmacSha256(
    await hmacSha256(
      await hmacSha256(
        await hmacSha256('AWS4' + secretAccessKey, shortDate),
        region
      ),
      service
    ),
    'aws4_request'
  );
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  // Build authorization header
  const authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;

  return {
    Authorization: authorization,
    'x-amz-date': dateStamp,
    'x-amz-content-sha256': payloadHash,
  };
}

/**
 * Build the S3 object URL
 */
function buildS3Url(env, objectKey) {
  const endpoint = (env.S3_ENDPOINT || 'https://s3.hi168.com').replace(/\/$/, '');
  const bucket = env.S3_BUCKET || 'hi168-32227-8062svww';
  return `${endpoint}/${bucket}/${objectKey}`;
}

/**
 * Fetch an object from S3, with optional signing
 */
async function fetchFromS3(objectKey, env) {
  const url = buildS3Url(env, objectKey);

  const headers = {};

  // If credentials are configured, sign the request
  if (env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY) {
    const authHeaders = await signRequest('GET', url, {}, '', env);
    Object.assign(headers, authHeaders);
  }

  return fetch(url, { method: 'GET', headers });
}

/**
 * Main request handler
 */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);

  // Only allow GET and HEAD methods
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  // Decode the pathname, rejecting malformed percent-encoding
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch (e) {
    return new Response('Bad Request', { status: 400 });
  }

  // Remove leading slash
  path = path.replace(/^\//, '');

  // Reject path traversal attempts
  if (path.split('/').some((seg) => seg === '..' || seg === '.')) {
    return new Response('Bad Request', { status: 400 });
  }

  // Default to index.html
  if (path === '' || path.endsWith('/')) {
    path += 'index.html';
  }

  // Try to fetch from S3
  let response = await fetchFromS3(path, env);

  // If not found and path has no extension, try path/index.html
  if (response.status === 404 || response.status === 403) {
    if (!path.includes('.')) {
      response = await fetchFromS3(path + '/index.html', env);
    }
  }

  // If still not found, return 404
  if (response.status === 404 || response.status === 403) {
    return new Response('Not Found', {
      status: 404,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // If S3 returned an error, pass it through
  if (!response.ok) {
    return new Response(`Upstream Error: ${response.status}`, {
      status: response.status,
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  // Build response with proper MIME type and caching headers
  const mimeType = getMimeType(path);
  const cacheTtl = parseInt(env.CACHE_TTL || '86400', 10);

  const responseHeaders = new Headers(response.headers);
  responseHeaders.set('Content-Type', mimeType);
  responseHeaders.set('Cache-Control', `public, max-age=${cacheTtl}`);
  responseHeaders.set('Access-Control-Allow-Origin', '*');

  // Remove S3-specific headers
  responseHeaders.delete('x-amz-request-id');
  responseHeaders.delete('x-amz-id-2');
  responseHeaders.delete('Server');

  const newResponse = new Response(response.body, {
    status: response.status,
    headers: responseHeaders,
  });

  return newResponse;
}

export default {
  fetch: handleRequest,
};
