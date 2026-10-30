import type { RequestUrlParam, RequestUrlResponse } from 'obsidian';
import type { HttpRequest, TokenSource } from './http';

/** A canned answer, matched by method and a piece of the URL. */
export interface Route {
    method: string;
    url: string | RegExp;
    status?: number;
    json?: unknown;
    text?: string;
}

/** A fake requestUrl for provider tests: answers from routes, in order, and records every call. */
export function fakeHttp(routes: Route[]): HttpRequest & { calls: RequestUrlParam[] } {
    const calls: RequestUrlParam[] = [];
    const request = async (param: RequestUrlParam): Promise<RequestUrlResponse> => {
        calls.push(param);
        const index = routes.findIndex(route => route.method === (param.method ?? 'GET')
            && (typeof route.url === 'string' ? param.url.includes(route.url) : route.url.test(param.url)));
        if (index === -1) throw new Error(`No route for ${param.method ?? 'GET'} ${param.url}`);
        const [route] = routes.splice(index, 1);
        const text = route.text ?? (route.json === undefined ? '' : JSON.stringify(route.json));
        return {
            status: route.status ?? 200,
            headers: {},
            text,
            get json() { return JSON.parse(text) as unknown; },
            arrayBuffer: new ArrayBuffer(0)
        };
    };
    return Object.assign(request, { calls });
}

export function fakeTokens(): TokenSource & { refreshed: number } {
    const tokens = {
        refreshed: 0,
        async access(force?: boolean): Promise<string> {
            if (force) tokens.refreshed++;
            return `token-${tokens.refreshed}`;
        }
    };
    return tokens;
}
