import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import { ProviderError } from './types';

/** Obsidian's requestUrl, or a fake in tests. */
export type HttpRequest = (param: RequestUrlParam) => Promise<RequestUrlResponse>;

/** Hands out an access token, refreshing it when it's about to run out or when asked to. */
export interface TokenSource {
    access(force?: boolean): Promise<string>;
}

/** A call that never throws for an HTTP status, only for a network failure, which becomes a ProviderError. */
export async function send(request: HttpRequest, param: RequestUrlParam): Promise<RequestUrlResponse> {
    try {
        return await request({ ...param, throw: false });
    } catch (error) {
        throw new ProviderError('other', error instanceof Error ? error.message : String(error));
    }
}

/** A call with a bearer token, refreshed once and retried if the provider says it's no longer good. */
export async function sendAuthed(request: HttpRequest, tokens: TokenSource, param: RequestUrlParam): Promise<RequestUrlResponse> {
    const withToken = (token: string): RequestUrlParam => ({ ...param, headers: { ...(param.headers ?? {}), Authorization: `Bearer ${token}` } });
    let response = await send(request, withToken(await tokens.access()));
    if (response.status === 401) response = await send(request, withToken(await tokens.access(true)));
    return response;
}

export function jsonOf(response: RequestUrlResponse): Record<string, unknown> {
    try {
        const parsed: unknown = response.json;
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

/** A provider's error as one line for the settings page. */
export function failure(provider: string, response: RequestUrlResponse): ProviderError {
    const json = jsonOf(response);
    const error = json.error;
    const detail = typeof error === 'object' && error !== null && typeof (error as Record<string, unknown>).message === 'string'
        ? (error as Record<string, string>).message
        : typeof error === 'string' ? error : '';
    if (response.status === 401) return new ProviderError('signed-out', `${provider} signed this device out. Sign in again.`);
    return new ProviderError('other', `${provider} answered ${response.status}${detail ? `: ${detail}` : ''}`);
}
