import {loadEnv} from './helpers/env';

const URL = 'https://readwise.io/api/v2/highlights/';
const okJson = (body: unknown, status = 200) => ({
  ok: status < 400, status, headers: {get: () => null}, json: async () => body, text: async () => '',
});

describe('client: what counts as a write', () => {
  test.each([
    ['GET', false], ['get', false], ['Get', false], ['HEAD', false], ['head', false], [undefined, false],
    ['POST', true], ['post', true], ['Post', true], ['PUT', true], ['put', true], ['PATCH', true],
    ['DELETE', true], ['OPTIONS', true], ['TRACE', true], ['CONNECT', true], ['PURGE', true],
    ['UNKNOWN', true], ['', true], [' GET', true], ['GET ', true], ['GET\n', true],
    [null, true], [0, true], [{}, true], [['GET'], true], [true, true],
  ])('method %j -> write: %j', async (method, expected) => {
    const {client} = await loadEnv({realClient: true});
    expect(client.isWriteMethod(method)).toBe(expected);
  });
});

describe('client: read-only mode enforced in the request function', () => {
  test.each(['POST', 'PUT', 'PATCH', 'DELETE', 'post', 'Post', 'put', 'OPTIONS', 'UNKNOWN', ''])(
    '%j is refused before any network I/O',
    async method => {
      const {client, fakes, writeGuard} = await loadEnv({realClient: true, writesEnabled: false});
      await expect(client.readwiseFetch(URL, {method, body: '{}'})).rejects.toBeInstanceOf(
        writeGuard.ReadwiseReadOnlyError,
      );
      expect(fakes.fetch).not.toHaveBeenCalled();
    },
  );

  test.each(['GET', 'get', 'HEAD', undefined])('%j still goes through in read-only mode', async method => {
    const {client, fakes} = await loadEnv({realClient: true, writesEnabled: false});
    await client.readwiseFetch(URL, method === undefined ? {} : {method});
    expect(fakes.fetch).toHaveBeenCalledTimes(1);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%s goes through once read-only mode is off', async method => {
    const {client, fakes} = await loadEnv({realClient: true, writesEnabled: true});
    await client.readwiseFetch(URL, {method});
    expect(fakes.fetch).toHaveBeenCalledTimes(1);
    expect(fakes.fetch.mock.calls[0][1].method).toBe(method);
  });

  test('a non-string method is treated as a write and refused', async () => {
    const {client, fakes} = await loadEnv({realClient: true, writesEnabled: false});
    await expect(client.readwiseFetch(URL, {method: 42 as any})).rejects.toThrow(/read-only/i);
    expect(fakes.fetch).not.toHaveBeenCalled();
  });

  test('an unreadable setting blocks writes but not reads', async () => {
    const env = await loadEnv({realClient: true, writesEnabled: true});
    jest.spyOn(env.db, 'getSetting').mockRejectedValue(new Error('locked'));
    await expect(env.client.readwiseFetch(URL, {method: 'POST'})).rejects.toThrow(/read-only/i);
    await env.client.readwiseFetch(URL, {method: 'GET'});
    expect(env.fakes.fetch).toHaveBeenCalledTimes(1);
  });

  test('every stored value other than "1" blocks the write', async () => {
    const env = await loadEnv({realClient: true, writesEnabled: false});
    for (const value of ['0', '', 'true', 'yes', ' 1', '01']) {
      await env.db.setSetting(env.schema.SettingsKey.ReadwiseWritesEnabled, value);
      await expect(env.client.readwiseFetch(URL, {method: 'POST'})).rejects.toThrow(/read-only/i);
    }
    expect(env.fakes.fetch).not.toHaveBeenCalled();
  });

  test('the setting is re-read per request: allowed, blocked, allowed again', async () => {
    const env = await loadEnv({realClient: true, writesEnabled: true});
    await env.client.readwiseFetch(URL, {method: 'POST'});
    await env.writeGuard.setReadwiseWritesEnabled(false);
    await expect(env.client.readwiseFetch(URL, {method: 'POST'})).rejects.toThrow(/read-only/i);
    await env.writeGuard.setReadwiseWritesEnabled(true);
    await env.client.readwiseFetch(URL, {method: 'POST'});
    expect(env.fakes.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('client: the typed Readwise calls', () => {
  test('createHighlights is refused in read-only mode, sends nothing', async () => {
    const {client, fakes, writeGuard} = await loadEnv({realClient: true, writesEnabled: false});
    await expect(client.createHighlights('tok', [{text: 'x', title: 'T'}])).rejects.toBeInstanceOf(
      writeGuard.ReadwiseReadOnlyError,
    );
    expect(fakes.fetch).not.toHaveBeenCalled();
  });

  test('createHighlights POSTs with the token and body when writes are enabled', async () => {
    const {client, fakes} = await loadEnv({realClient: true, writesEnabled: true});
    fakes.fetch.mockResolvedValue(okJson([{id: 1}]));
    const result = await client.createHighlights('tok123', [{text: 'hello', title: 'T'}]);
    expect(result).toEqual([{id: 1}]);
    const [url, init] = fakes.fetch.mock.calls[0];
    expect(url).toBe(URL);
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Token tok123');
    expect(JSON.parse(init.body)).toEqual({highlights: [{text: 'hello', title: 'T'}]});
  });

  test.each([true, false])('an empty batch returns [] without any request (writes enabled: %s)', async enabled => {
    const {client, fakes} = await loadEnv({realClient: true, writesEnabled: enabled});
    expect(await client.createHighlights('tok', [])).toEqual([]);
    expect(fakes.fetch).not.toHaveBeenCalled();
  });

  test('validateToken and fetchExportPage (both GET) work in read-only mode', async () => {
    const {client, fakes} = await loadEnv({realClient: true, writesEnabled: false});
    fakes.fetch.mockResolvedValueOnce({ok: true, status: 204, headers: {get: () => null}});
    expect(await client.validateToken('tok')).toBe(true);
    fakes.fetch.mockResolvedValueOnce(okJson({count: 0, nextPageCursor: null, results: []}));
    expect(await client.fetchExportPage('tok', {includeDeleted: true})).toEqual({
      count: 0, nextPageCursor: null, results: [],
    });
    expect(fakes.fetch.mock.calls.map((c: any[]) => c[1].method)).toEqual(['GET', 'GET']);
  });

  test('a failing write (server error) is still reported as an API error when writes are enabled', async () => {
    const {client, fakes} = await loadEnv({realClient: true, writesEnabled: true});
    fakes.fetch.mockResolvedValue({
      ok: false, status: 500, statusText: 'boom', headers: {get: () => null}, text: async () => 'server exploded',
    });
    await expect(client.createHighlights('tok', [{text: 'x', title: 'T'}])).rejects.toMatchObject({name: 'ReadwiseApiError'});
  });
});
