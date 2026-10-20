import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet, View} from 'react-native';
import {listHighlights, markHighlightInsertedIntoNote} from '../db';
import type {LocalHighlightRow} from '../readwise/types';
import {insertQuoteIntoCurrentNote} from '../lib/insertQuote';
import {
  BodyText,
  Dashes,
  EmptyText,
  SecondaryButton,
  StatusText,
  TextField,
} from '../snuxlib';

const SEARCH_DEBOUNCE_MS = 300;
const RESULTS_LIMIT = 30;
const QUOTE_PREVIEW_CHARS = 280;

type InsertState = 'idle' | 'inserting' | 'inserted' | 'error';

interface Props {
  log: (text: string) => void;
}

function preview(text: string): string {
  return text.length > QUOTE_PREVIEW_CHARS ? `${text.slice(0, QUOTE_PREVIEW_CHARS).trimEnd()}…` : text;
}

// The buttons carry no bottom margin, so give the rule room above it (and a little below).
const styles = StyleSheet.create({
  separator: {marginTop: 28, marginBottom: 4},
});

/** Tab content -- no header/back button of its own, the tab menu in App.tsx is the only
 * navigation. See plans/plan.md for the "default to Insert a Quote" UX decision. The search field
 * is first: the on-screen keyboard covers the lower half of the screen. */
export default function InsertQuote({log}: Props): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<LocalHighlightRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [insertState, setInsertState] = useState<Record<number, InsertState>>({});
  const [insertError, setInsertError] = useState<string | null>(null);

  const runSearch = useCallback(async (search: string) => {
    setLoading(true);
    try {
      const rows = await listHighlights({search, limit: RESULTS_LIMIT});
      setResults(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => runSearch(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const handleInsert = async (row: LocalHighlightRow) => {
    if (insertState[row.readwise_id] === 'inserting') {return;}
    setInsertError(null);
    setInsertState(prev => ({...prev, [row.readwise_id]: 'inserting'}));
    try {
      await insertQuoteIntoCurrentNote({
        text: row.text,
        bookTitle: row.book_title,
        bookAuthor: row.book_author,
      });
      const now = new Date().toISOString();
      await markHighlightInsertedIntoNote(row.readwise_id, now);
      setResults(prev =>
        prev.map(r =>
          r.readwise_id === row.readwise_id ? {...r, inserted_into_note_at: now} : r,
        ),
      );
      setInsertState(prev => ({...prev, [row.readwise_id]: 'inserted'}));
      log(`Inserted quote ${row.readwise_id} into the note.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not insert quote.';
      setInsertState(prev => ({...prev, [row.readwise_id]: 'error'}));
      setInsertError(message);
      log(`Insert of quote ${row.readwise_id} failed: ${message}`);
    }
  };

  return (
    <>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder="Search highlights, book, or author"
      />
      {insertError ? <StatusText>{insertError}</StatusText> : null}

      {loading ? (
        <EmptyText>Loading…</EmptyText>
      ) : results.length === 0 ? (
        <EmptyText>
          {query.trim().length > 0 ? 'No highlights match your search.' : 'No highlights cached yet.'}
        </EmptyText>
      ) : (
        results.map(item => {
          const state = insertState[item.readwise_id] ?? 'idle';
          const attribution = [item.book_title, item.book_author].filter(Boolean).join(' \u2014 ');
          return (
            <React.Fragment key={item.readwise_id}>
              <BodyText>{preview(item.text)}</BodyText>
              {attribution ? <StatusText>{attribution}</StatusText> : null}
              <SecondaryButton
                label={
                  state === 'inserting'
                    ? 'Inserting…'
                    : state === 'inserted'
                      ? 'Inserted \u2713'
                      : item.inserted_into_note_at
                        ? 'Insert again'
                        : 'Insert into note'
                }
                onPress={() => handleInsert(item)}
              />
              <View style={styles.separator}>
                <Dashes />
              </View>
            </React.Fragment>
          );
        })
      )}
    </>
  );
}
