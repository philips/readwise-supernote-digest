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

interface Props {
  onBack: () => void;
}

const SEARCH_DEBOUNCE_MS = 300;
const RESULTS_LIMIT = 30;

type InsertState = 'idle' | 'inserting' | 'inserted' | 'error';

export default function InsertQuote({onBack}: Props): React.JSX.Element {
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
            <ActivityIndicator size="small" color="#ffffff" />
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
      <View style={styles.header}>
        <Pressable onPress={onBack} hitSlop={12}>
          <Text style={styles.backText}>{'\u2039 Back'}</Text>
        </Pressable>
        <Text style={styles.title}>Insert a quote</Text>
      </View>

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
    backgroundColor: '#ffffff',
    paddingTop: 24,
  },
  header: {
    paddingHorizontal: 24,
    marginBottom: 12,
  },
  backText: {
    fontSize: 15,
    color: '#000000',
    marginBottom: 8,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    color: '#000000',
  },
  searchInput: {
    marginHorizontal: 24,
    borderWidth: 1,
    borderColor: '#000000',
    borderRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
    color: '#000000',
  },
  loading: {
    marginTop: 40,
  },
  empty: {
    marginTop: 40,
    textAlign: 'center',
    color: '#333333',
    fontSize: 15,
    paddingHorizontal: 24,
  },
  list: {
    paddingHorizontal: 24,
    paddingBottom: 24,
  },
  card: {
    borderWidth: 1,
    borderColor: '#cccccc',
    borderRadius: 4,
    padding: 14,
    marginBottom: 12,
  },
  quoteText: {
    fontSize: 15,
    color: '#000000',
    marginBottom: 6,
  },
  attribution: {
    fontSize: 13,
    color: '#555555',
    marginBottom: 10,
  },
  insertButton: {
    backgroundColor: '#000000',
    borderRadius: 4,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
  },
  insertButtonDisabled: {
    opacity: 0.5,
  },
  insertButtonText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '600',
  },
  error: {
    color: '#a00000',
    fontSize: 14,
    marginHorizontal: 24,
    marginBottom: 12,
  },
});
