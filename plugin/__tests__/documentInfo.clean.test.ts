import {
  cleanAuthor,
  cleanTitle,
  isJunkAuthor,
  isJunkTitle,
  joinAuthors,
  restoreFilenameUnderscores,
  uninvertArticle,
} from '../src/lib/documentInfo/clean';

describe('isJunkTitle', () => {
  test.each([
    '',
    ' ',
    'x',
    'Untitled',
    'untitled document',
    'Untitled-1',
    'Untitled (3)',
    'Unknown',
    'book',
    'Book2',
    'Document1',
    'PowerPoint Presentation',
    'Slide 1',
    'report.docx',
    'thesis.tex',
    'subc.dvi',
    'Microsoft Word - report.doc',
    'Microsoft PowerPoint - deck',
    'IMG_0042',
  ])('junk: %j', t => expect(isJunkTitle(t)).toBe(true));

  test.each([
    'Concrete Mathematics',
    'Untitled Masterpiece Chronicles', // starts like junk, isn't
    'The Book Thief',
    'Bookkeeping for Dummies',
    'A Document of the Age',
    '1984', // all-digit titles can be real
    '451',
    'Untitled: A Memoir',
    'HOW TO PROVE IT: A Structured Approach',
  ])('real: %j', t => expect(isJunkTitle(t)).toBe(false));

  test('null / undefined are junk', () => {
    expect(isJunkTitle(null)).toBe(true);
    expect(isJunkTitle(undefined)).toBe(true);
  });
});

describe('isJunkAuthor', () => {
  test.each(['', 'Unknown', 'UNKNOWN', 'Admin', 'user', 'Microsoft Office User', 'a', null, undefined])(
    'junk: %j',
    a => expect(isJunkAuthor(a as any)).toBe(true),
  );
  test.each(['Isaac Asimov', 'Ursula K. le Guin', 'bell hooks', 'Unknownson'])('real: %j', a =>
    expect(isJunkAuthor(a)).toBe(false),
  );
});

describe('title normalisation', () => {
  test.each([
    ['Unreal and the Real, The', 'The Unreal and the Real'],
    ['Spare Man, The', 'The Spare Man'],
    ['Meaning of Work in the New Economy, The', 'The Meaning of Work in the New Economy'],
    ['Odyssey, An', 'An Odyssey'],
    ['Tale, A', 'A Tale'],
    ['Hello, World', 'Hello, World'], // comma but not a trailing article
    ['Thé, Rita', 'Thé, Rita'],
    ['  Padded   spaces \n here ', 'Padded spaces here'],
  ])('%j -> %j', (i, o) => expect(cleanTitle(i)).toBe(o));

  test('uninvertArticle only touches a trailing article', () => {
    expect(uninvertArticle('Theory, Then Practice')).toBe('Theory, Then Practice');
    expect(uninvertArticle('Cat in the Hat, The')).toBe('The Cat in the Hat');
  });
});

describe('restoreFilenameUnderscores', () => {
  test.each([
    ['HOW TO PROVE IT_ A Structured Approach', 'HOW TO PROVE IT: A Structured Approach'],
    ['Comet in Moominland_ Can Moomintroll save', 'Comet in Moominland: Can Moomintroll save'],
    ['Meet Jesus _ the life', 'Meet Jesus : the life'],
    ['The_Boy_and_the_Tape', 'The Boy and the Tape'],
    ['snake_case_name', 'snake case name'],
    ['No underscores here', 'No underscores here'],
    ['mixed_case and spaces', 'mixed_case and spaces'], // underscore not followed by a space: untouched
  ])('%j -> %j', (i, o) => expect(restoreFilenameUnderscores(i)).toBe(o));
});

describe('author normalisation', () => {
  test.each([
    ['Mahajan, Sanjoy', 'Sanjoy Mahajan'],
    ['Eaton, Maxwell', 'Maxwell Eaton'],
    ['Gunney, Lynn Tuttle', 'Lynn Tuttle Gunney'],
    ['Isaac Asimov', 'Isaac Asimov'],
    ['Chris Baldry, Peter Bain', 'Chris Baldry, Peter Bain'], // two authors, not "Last, First"
    ['Chris Baldry, et al.', 'Chris Baldry, et al.'],
    ['Baldry, et al.', 'Baldry, et al.'],
    ['Dan Harmon & Mondy Carter & Rob Schrab', 'Dan Harmon, Mondy Carter, Rob Schrab'],
    ['Chris Baldry, et al_', 'Chris Baldry, et al.'],
    ['Daniel J.Velleman', 'Daniel J.Velleman'],
    ['  Padded   Name ', 'Padded Name'],
    ['A, B, C', 'A, B, C'],
  ])('%j -> %j', (i, o) => expect(cleanAuthor(i)).toBe(o));

  test('joinAuthors drops junk and joins with commas', () => {
    expect(joinAuthors(['Peter Thiel', 'Blake Masters'])).toBe('Peter Thiel, Blake Masters');
    expect(joinAuthors(['Unknown'])).toBeNull();
    expect(joinAuthors([])).toBeNull();
    expect(joinAuthors(['Real Person', 'Unknown', ''])).toBe('Real Person');
  });
});
