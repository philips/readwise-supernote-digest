import {loadEnv} from './helpers/env';

const PATH = '/storage/emulated/0/Document/Some Book - Filename Author.pdf';

async function setup() {
  const env = await loadEnv();
  const native = {
    readDocumentMetadata: jest.fn(),
  };
  native.readDocumentMetadata.mockResolvedValue({exists: true, size: 100, mtime: 5});
  jest.doMock('../src/lib/documentInfo/nativeBridge', () => native);
  const {resolveDocumentInfo} = require('../src/lib/documentInfo/resolve');
  return {...env, native, resolveDocumentInfo};
}

describe('resolveDocumentInfo: source priority', () => {
  test('embedded beats filename', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 1, mtime: 1, format: 'epub', title: 'Embedded Title', authors: ['Ann Author'],
    });
    expect(await resolveDocumentInfo(PATH)).toMatchObject({
      title: 'Embedded Title', author: 'Ann Author', titleSource: 'embedded', authorSource: 'embedded', format: 'epub',
    });
  });

  test('filename is the last resort', async () => {
    const {resolveDocumentInfo} = await setup();
    expect(await resolveDocumentInfo(PATH)).toMatchObject({
      title: 'Some Book', author: 'Filename Author', titleSource: 'filename', authorSource: 'filename',
    });
  });

  test('fields fall through independently (embedded title, filename author)', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 1, mtime: 1, format: 'pdf', title: 'Good Title', authors: [],
    });
    expect(await resolveDocumentInfo(PATH)).toMatchObject({
      title: 'Good Title', titleSource: 'embedded', author: 'Filename Author', authorSource: 'filename',
    });
  });

  test('junk embedded title falls through to the filename', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 1, mtime: 1, format: 'pdf', title: 'Microsoft Word - draft.doc', authors: ['Admin'],
    });
    expect(await resolveDocumentInfo(PATH)).toMatchObject({
      title: 'Some Book', titleSource: 'filename', author: 'Filename Author', authorSource: 'filename',
    });
  });

  test('everything junk: title is the cleaned stem, author null, never empty', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({exists: true, size: 1, mtime: 1});
    const info = await resolveDocumentInfo('/d/book - Unknown.pdf');
    expect(info.title).toBe('book - Unknown');
    expect(info.author).toBeNull();
    expect(info.authorSource).toBeNull();
  });

  test('a file with no metadata at all and no author in the name', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({exists: true, size: 1, mtime: 1});
    expect(await resolveDocumentInfo('/d/Where There is No Doctor.pdf')).toMatchObject({
      title: 'Where There is No Doctor', author: null,
    });
  });

  test('native error string (unreadable file) still resolves via filename', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({exists: true, size: 1, mtime: 1, error: 'ZipException: bad'});
    expect((await resolveDocumentInfo(PATH)).titleSource).toBe('filename');
  });
});

describe('resolveDocumentInfo: paths', () => {
  test('Digest source paths are relative to shared storage', async () => {
    const {native, resolveDocumentInfo} = await setup();
    await resolveDocumentInfo('Document/Fables - Aesop.epub');
    expect(native.readDocumentMetadata).toHaveBeenCalledWith('/storage/emulated/0/Document/Fables - Aesop.epub');
  });

  test('cloud-sync paths resolve too, absolute paths are left alone', async () => {
    const {native, resolveDocumentInfo, toAbsolutePath} = await setup().then(e => ({
      ...e,
      toAbsolutePath: require('../src/lib/documentInfo/resolve').toAbsolutePath,
    }));
    await resolveDocumentInfo('Android/data/com.ratta.supernote.serverlink/files/sync/2/books/X.pdf');
    expect(native.readDocumentMetadata).toHaveBeenCalledWith(
      '/storage/emulated/0/Android/data/com.ratta.supernote.serverlink/files/sync/2/books/X.pdf',
    );
    expect(toAbsolutePath('/sdcard/x.pdf')).toBe('/sdcard/x.pdf');
  });

  test('relative and absolute spellings of one file share a cache entry', async () => {
    const {native, resolveDocumentInfo} = await setup();
    await resolveDocumentInfo('Document/A - B.pdf');
    native.readDocumentMetadata.mockClear();
    await resolveDocumentInfo('/storage/emulated/0/Document/A - B.pdf');
    expect(native.readDocumentMetadata).not.toHaveBeenCalled();
  });
});

describe('resolveDocumentInfo: cache stability', () => {
  test('a failed read (e.g. FILE:READ not granted yet) is not sticky: upgraded once readable', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 100, mtime: 5, error: 'SecurityException: no READ permission',
    });
    const guess = await resolveDocumentInfo(PATH);
    expect(guess.titleSource).toBe('filename');

    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 100, mtime: 5, format: 'pdf', title: 'Real Title', authors: ['Real Author'],
    });
    expect(await resolveDocumentInfo(PATH)).toMatchObject({title: 'Real Title', titleSource: 'embedded'});
  });

  test('while reads keep failing the earlier answer is reused, not re-guessed', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({exists: true, size: 1, mtime: 1, error: 'boom'});
    const a = await resolveDocumentInfo(PATH);
    const b = await resolveDocumentInfo(PATH);
    expect(b).toEqual(a);
  });

  test('second call is served from cache without touching the file', async () => {
    const {native, resolveDocumentInfo} = await setup();
    const first = await resolveDocumentInfo(PATH);
    native.readDocumentMetadata.mockClear();
    const second = await resolveDocumentInfo(PATH);
    expect(second).toEqual(first);
    expect(native.readDocumentMetadata).not.toHaveBeenCalled();
  });

  test('title stays put even if the file\'s metadata changes later (Readwise de-dupe)', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 1, mtime: 1, format: 'pdf', title: 'Original Title', authors: ['A B'],
    });
    await resolveDocumentInfo(PATH);
    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 2, mtime: 2, format: 'pdf', title: 'Edited Title', authors: ['C D'],
    });
    expect((await resolveDocumentInfo(PATH)).title).toBe('Original Title');
  });

  test('a filename guess made while the file was missing is upgraded once the file appears', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({exists: false});
    const guess = await resolveDocumentInfo(PATH);
    expect(guess.titleSource).toBe('filename');

    native.readDocumentMetadata.mockResolvedValue({
      exists: true, size: 9, mtime: 9, format: 'pdf', title: 'Real Title', authors: ['Real Author'],
    });
    expect(await resolveDocumentInfo(PATH)).toMatchObject({title: 'Real Title', titleSource: 'embedded'});
  });

  test('while the file stays missing the earlier answer is reused', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockResolvedValue({exists: false});
    const a = await resolveDocumentInfo(PATH);
    const b = await resolveDocumentInfo(PATH);
    expect(b).toEqual(a);
  });

  test('cache is per path', async () => {
    const {native, resolveDocumentInfo} = await setup();
    native.readDocumentMetadata.mockImplementation(async (p: string) => ({
      exists: true, size: 1, mtime: 1, format: 'pdf', title: p.includes('a') ? 'Title A' : 'Title B', authors: [],
    }));
    expect((await resolveDocumentInfo('/x/a.pdf')).title).toBe('Title A');
    expect((await resolveDocumentInfo('/x/b.pdf')).title).toBe('Title B');
  });

  test('survives an app restart (persisted in SQLite) and is wiped by clearAllData', async () => {
    const first = await setup();
    await first.resolveDocumentInfo(PATH);

    const second = await (async () => {
      const env = await loadEnv({keepDatabase: true});
      const native = {readDocumentMetadata: jest.fn()};
      jest.doMock('../src/lib/documentInfo/nativeBridge', () => native);
      return {env, native, resolve: require('../src/lib/documentInfo/resolve').resolveDocumentInfo};
    })();
    expect((await second.resolve(PATH)).title).toBe('Some Book');
    expect(second.native.readDocumentMetadata).not.toHaveBeenCalled();

    await second.env.db.clearAllData();
    expect(await second.env.db.getDocumentInfoCache(PATH)).toBeNull();
  });
});
