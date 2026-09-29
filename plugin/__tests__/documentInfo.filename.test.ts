import {parseFilename} from '../src/lib/documentInfo/filename';

describe('parseFilename (names as seen in /sdcard/Document)', () => {
  test.each([
    ['/sdcard/Document/Winnie-the-Pooh - A. A. Milne.epub', 'Winnie-the-Pooh', 'A. A. Milne'],
    ['Fables - Aesop.epub', 'Fables', 'Aesop'],
    ['Nettle & Bone - T. Kingfisher.epub', 'Nettle & Bone', 'T. Kingfisher'],
    ["Asimov's Guide to Shakespeare - Isaac Asimov.pdf", "Asimov's Guide to Shakespeare", 'Isaac Asimov'],
    ['Spare Man, The - Mary Robinette Kowal.epub', 'The Spare Man', 'Mary Robinette Kowal'],
    [
      'Art of Insight in Science and Engineering, The - Mahajan, Sanjoy.pdf',
      'The Art of Insight in Science and Engineering',
      'Sanjoy Mahajan',
    ],
    [
      'HOW TO PROVE IT_ A Structured Approach, Second Edition - Daniel J.Velleman.pdf',
      'HOW TO PROVE IT: A Structured Approach, Second Edition',
      'Daniel J.Velleman',
    ],
    [
      'Scud_ The Disposable Assassin_ The Whole Shebang - Dan Harmon & Mondy Carter & Rob Schrab.epub',
      'Scud: The Disposable Assassin: The Whole Shebang',
      'Dan Harmon, Mondy Carter, Rob Schrab',
    ],
    ['2019-InvariantsUpdated - Leslie Daigle.pdf', '2019-InvariantsUpdated', 'Leslie Daigle'],
    ['Title - Sub - Author Name.pdf', 'Title - Sub', 'Author Name'], // last " - " wins
  ])('%s', (name, title, author) => {
    const r = parseFilename(name);
    expect(r.title).toBe(title);
    expect(r.author).toBe(author);
  });

  test.each([
    ['book - Unknown.pdf', null, null],
    ['Unknown - Daniel Solow.pdf', null, 'Daniel Solow'],
    ['Unknown - David Harel.pdf', null, 'David Harel'],
    ['Untitled - Unknown.pdf', null, null],
  ])('junk parts are dropped: %s', (name, title, author) => {
    const r = parseFilename(name);
    expect(r.title).toBe(title);
    expect(r.author).toBe(author);
  });

  test('no " - ": whole stem is the title, no author', () => {
    expect(parseFilename('1987-mcdermott.pdf')).toMatchObject({title: '1987-mcdermott', author: null});
    expect(parseFilename('The_Boy_and_the_Tape.pdf')).toMatchObject({title: 'The Boy and the Tape', author: null});
    expect(parseFilename('mausritter-rules-2.3.pdf')).toMatchObject({title: 'mausritter-rules-2.3', author: null});
  });

  test('stem is always available as a last resort, even when title is junk', () => {
    expect(parseFilename('book - Unknown.pdf').stem).toBe('book - Unknown');
    expect(parseFilename('IMG_0042.pdf').title).toBeNull();
    expect(parseFilename('IMG_0042.pdf').stem).toBeTruthy();
  });

  test('extensions of various lengths, none, and dotted names', () => {
    expect(parseFilename('A Book - Someone.epub').title).toBe('A Book');
    expect(parseFilename('A Book - Someone.azw3').title).toBe('A Book');
    expect(parseFilename('A Book - Someone').title).toBe('A Book');
    expect(parseFilename('Dr. Strangelove - Terry Southern.pdf')).toMatchObject({
      title: 'Dr. Strangelove',
      author: 'Terry Southern',
    });
  });

  test('directory components never leak into the title', () => {
    expect(parseFilename('/a - b/c/Real Title - Real Author.pdf')).toMatchObject({
      title: 'Real Title',
      author: 'Real Author',
    });
  });

  test('empty / weird input does not throw', () => {
    expect(() => parseFilename('')).not.toThrow();
    expect(() => parseFilename('/')).not.toThrow();
    expect(() => parseFilename(' - ')).not.toThrow();
    expect(() => parseFilename('.pdf')).not.toThrow();
  });
});
