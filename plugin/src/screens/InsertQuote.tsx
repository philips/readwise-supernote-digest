import React, {useCallback, useEffect, useState} from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {listHighlights, markHighlightInsertedIntoNote} from '../db';
import type {LocalHighlightRow} from '../readwise/types';
import {insertQuoteIntoCurrentNote} from '../lib/insertQuote';
import {Color, FontSize} from '../theme';

const SEARCH_DEBOUNCE_MS = 300;
const RESULTS_LIMIT = 30;

type InsertState = 'idle' | 'inserting' | 'inserted' | 'error';

/** Tab content -- no header/back button of its own, the tab bar in App.tsx is the only
 * navigation. See plans/plan.md for the "default to Insert a Quote" UX decision. */
export default function InsertQuote(): React.JSX.Element {
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
    } catch (err) {
      setInsertState(prev => ({...prev, [row.readwise_id]: 'error'}));
      setInsertError(err instanceof Error ? err.message : 'Could not insert quote.');
    }
  };

  const renderItem = ({item}: {item: LocalHighlightRow}) => {
    const state = insertState[item.readwise_id] ?? 'idle';
    const alreadyInserted = Boolean(item.inserted_into_note_at);
    return (
      <View style={styles.card}>
        <Text style={styles.quoteText} numberOfLines={4}>
          {item.text}
        </Text>
        {(item.book_title || item.book_author) && (
          <Text style={styles.attribution} numberOfLines={1}>
            {[item.book_title, item.book_author].filter(Boolean).join(' \u2014 ')}
          </Text>
        )}
        <Pressable
          style={[styles.insertButton, state === 'inserting' && styles.insertButtonDisabled]}
          disabled={state === 'inserting'}
          onPress={() => handleInsert(item)}>
          {state === 'inserting' ? (
            <ActivityIndicator size="small" color={Color.background} />
          ) : (
            <Text style={styles.insertButtonText}>
              {state === 'inserted'
                ? 'Inserted \u2713'
                : alreadyInserted
                  ? 'Insert again'
                  : 'Insert into note'}
            </Text>
          )}
        </Pressable>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchInput}
        value={query}
        onChangeText={setQuery}
        placeholder="Search highlights, book, or author"
        autoCapitalize="none"
        autoCorrect={false}
      />

      {insertError ? <Text style={styles.error}>{insertError}</Text> : null}

      {loading ? (
        <ActivityIndicator style={styles.loading} />
      ) : results.length === 0 ? (
        <Text style={styles.empty}>
          {query.trim().length > 0 ? 'No highlights match your search.' : 'No highlights cached yet.'}
        </Text>
      ) : (
        <FlatList
          data={results}
          keyExtractor={item => String(item.readwise_id)}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Color.background,
    paddingTop: 20,
  },
  searchInput: {
    marginHorizontal: 24,
    borderWidth: 2,
    borderColor: Color.border,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: FontSize.input,
    marginBottom: 16,
    color: Color.text,
  },
  loading: {
    marginTop: 40,
  },
  empty: {
    marginTop: 40,
    textAlign: 'center',
    color: Color.mutedText,
    fontSize: FontSize.body,
    paddingHorizontal: 24,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  card: {
    borderWidth: 2,
    borderColor: Color.mutedBorder,
    padding: 16,
    marginBottom: 16,
  },
  quoteText: {
    fontSize: FontSize.body,
    lineHeight: FontSize.body * 1.35,
    color: Color.text,
    marginBottom: 8,
  },
  attribution: {
    fontSize: FontSize.meta,
    color: Color.mutedText,
    marginBottom: 12,
  },
  insertButton: {
    backgroundColor: Color.text,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 20,
  },
  insertButtonDisabled: {
    opacity: 0.5,
  },
  insertButtonText: {
    color: Color.background,
    fontSize: FontSize.meta,
    fontWeight: '600',
  },
  error: {
    color: Color.error,
    fontSize: FontSize.meta,
    marginHorizontal: 24,
    marginBottom: 12,
  },
});
