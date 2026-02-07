/**
 * HTTP utilities for making requests.
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';

/**
 * HTTP response type.
 */
export interface HttpResponse<T> {
  status: number;
  statusText: string;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

/**
 * HTTP request options.
 */
export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  retries?: number;
  proxy?: string;
}

/**
 * HTTP error class.
 */
export class HttpError extends Error {
  constructor(
    public status: number,
    public statusText: string,
    message: string
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/**
 * Gets proxy URL from environment variables.
 * @param targetUrl The target URL
 * @returns Proxy URL or undefined
 */
function getProxyUrl(targetUrl: string): string | undefined {
  const url = new URL(targetUrl);
  const isHttps = url.protocol === 'https:';
  
  return process.env.HTTPS_PROXY || process.env.https_proxy ||
         (isHttps ? undefined : (process.env.HTTP_PROXY || process.env.http_proxy));
}

/**
 * Makes an HTTP request.
 * @param url The URL to request
 * @param options Request options
 * @returns Promise resolving to HTTP response
 */
export async function httpRequest<T>(
  url: string,
  options: HttpRequestOptions = {}
): Promise<HttpResponse<T>> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 10000,
    retries = 1,
    proxy
  } = options;

  const proxyUrl = proxy || getProxyUrl(url);
  let attempt = 0;
  let lastError: Error | undefined;

  while (attempt <= retries) {
    try {
      return await makeRequest<T>(url, {
        method,
        headers,
        body,
        timeout,
        proxyUrl
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      attempt++;
      
      // Don't retry on client errors (4xx)
      if (error instanceof HttpError && error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      if (attempt <= retries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt - 1), 5000)));
      }
    }
  }

  throw lastError || new Error('Request failed');
}

/**
 * Makes a single HTTP request (internal).
 */
async function makeRequest<T>(
  url: string,
  options: {
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    timeout: number;
    proxyUrl?: string;
  }
): Promise<HttpResponse<T>> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;

    const requestOptions: http.RequestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'AIdome-Switchboard-VSCode/1.0',
        ...options.headers
      },
      timeout: options.timeout
    };

    // Handle proxy if configured
    if (options.proxyUrl) {
      const proxyParsed = new URL(options.proxyUrl);
      requestOptions.hostname = proxyParsed.hostname;
      requestOptions.port = proxyParsed.port || (proxyParsed.protocol === 'https:' ? 443 : 80);
      requestOptions.path = url;
      requestOptions.headers = {
        ...requestOptions.headers,
        Host: parsedUrl.hostname
      };
    }

    const bodyData = options.body ? JSON.stringify(options.body) : undefined;
    if (bodyData && requestOptions.headers) {
      (requestOptions.headers as Record<string, string | number>)['Content-Length'] = Buffer.byteLength(bodyData);
    }

    const req = client.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });

      res.on('end', () => {
        const responseBody = Buffer.concat(chunks).toString('utf-8');
        const status = res.statusCode || 0;
        const statusText = res.statusMessage || '';

        // Parse response body
        let parsedBody: T;
        try {
          parsedBody = responseBody ? JSON.parse(responseBody) : ({} as T);
        } catch {
          // If JSON parsing fails, return raw body
          parsedBody = responseBody as unknown as T;
        }

        // Check for HTTP errors
        if (status >= 400) {
          reject(new HttpError(
            status,
            statusText,
            `HTTP ${status}: ${statusText}\n${responseBody}`
          ));
          return;
        }

        resolve({
          status,
          statusText,
          headers: res.headers as Record<string, string | string[] | undefined>,
          body: parsedBody
        });
      });
    });

    req.on('error', (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Request timeout after ${options.timeout}ms`));
    });

    if (bodyData) {
      req.write(bodyData);
    }

    req.end();
  });
}

/**
 * Makes an HTTP GET request.
 * @param url The URL to fetch
 * @param headers Optional headers
 * @returns Promise resolving to response data
 */
export async function httpGet<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await httpRequest<T>(url, {
    method: 'GET',
    headers
  });
  return response.body;
}

/**
 * Makes an HTTP POST request.
 * @param url The URL to post to
 * @param data The data to post
 * @param headers Optional headers
 * @returns Promise resolving to response data
 */
export async function httpPost<T>(
  url: string,
  data: unknown,
  headers?: Record<string, string>
): Promise<T> {
  const response = await httpRequest<T>(url, {
    method: 'POST',
    headers,
    body: data
  });
  return response.body;
}

/**
 * Checks if a URL is reachable.
 * @param url The URL to check
 * @returns Promise resolving to true if reachable
 */
export async function isUrlReachable(url: string): Promise<boolean> {
  try {
    await httpRequest(url, {
      method: 'GET',
      timeout: 5000,
      retries: 0
    });
    return true;
  } catch {
    return false;
  }
}
