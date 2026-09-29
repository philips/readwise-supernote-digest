package com.plugin

import android.content.ContentUris
import android.content.ContentValues
import android.net.Uri
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap

/**
 * Direct integration with Supernote's native Digest feature, via the
 * `com.ratta.supernote.knowledge.provider` ContentProvider that backs the on-device "Digest" app
 * (Settings/sidebar entry point: KnowledgeActivity, tabs Documents / Notes / Manual Entry).
 *
 * Background: the SDK (sn-plugin-lib) has no API surface for this at all, and the provider is
 * gated behind `READ_KNOWLEDGE`/`WRITE_KNOWLEDGE`, which nothing in the plugin-permission system
 * (`plugin.permission.*`) can request. It works anyway: `KnowledgeContentProvider`'s permission
 * check is `!isTrustedCaller() && checkCallingOrSelfPermission(...) != GRANTED`, and empirically
 * (see plans/plan.md "Task 3" for the full investigation) `checkCallingOrSelfPermission` already
 * returns GRANTED for the PluginHost process -- it runs as uid 1000 (`android.uid.system`, shared
 * with the Knowledge app itself), and that UID-level grant applies independently of
 * `isTrustedCaller()`'s hardcoded package allowlist (which does NOT include pluginhost). The
 * `uses-permission` entries in this module's AndroidManifest.xml are declared for documentation/
 * defensiveness but are not what's actually making this work.
 *
 * The provider's URI schema and required ContentValues keys are undocumented -- reverse engineered
 * by decompiling `/system_ext/app/SupernoteKnowledge/SupernoteKnowledge.apk` (jadx). Only the
 * specific paths this module uses are exercised/verified on-device; the provider exposes a good
 * deal more (tags, restore/sync endpoints, etc.) gated by an `isTrustedCaller()` allowlist
 * (`note`, `document`, `settings`, `background`, `inkhub`) that pluginhost is NOT on -- those
 * remain genuinely inaccessible to a plugin, but nothing we need here is on that list.
 */
class KnowledgeProviderModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  companion object {
    private const val AUTHORITY = "com.ratta.supernote.knowledge.provider"
    private val BASE_URI: Uri = Uri.parse("content://$AUTHORITY")

    // KnowledgeFieldNameConstants.KNOWLEDGE_SOURCE_TYPE_SELF_ADD -- matches what the on-device
    // "Manual Entry" UI creates, and is what makes entries show up in that tab of the Digest app.
    private const val SOURCE_TYPE_SELF_ADD = 4
  }

  override fun getName(): String = "KnowledgeProvider"

  /**
   * Looks up a Digest category (a `knowledge_base` row) by name, creating it if it doesn't exist.
   * Resolves with the category's `unique_attribute`, which is what `insertEntry` needs to file an
   * entry under this category.
   */
  @ReactMethod
  fun getOrCreateCategory(name: String, promise: Promise) {
    try {
      val existing = queryCategoryUniqueAttributeByName(name)
      if (existing != null) {
        promise.resolve(existing)
        return
      }

      val values = ContentValues()
      values.put("name", name)
      val insertedUri =
          reactApplicationContext.contentResolver.insert(
              Uri.withAppendedPath(BASE_URI, "knowledge_base"),
              values,
          )
      if (insertedUri == null) {
        promise.reject("KNOWLEDGE_BASE_INSERT_FAILED", "insert() returned null Uri")
        return
      }

      val id = ContentUris.parseId(insertedUri)
      val uniqueAttribute = queryCategoryUniqueAttributeById(id)
      if (uniqueAttribute == null) {
        promise.reject(
            "KNOWLEDGE_BASE_READBACK_FAILED",
            "Inserted knowledge_base row $id but could not read back its unique_attribute",
        )
        return
      }
      promise.resolve(uniqueAttribute)
    } catch (e: Exception) {
      promise.reject("KNOWLEDGE_BASE_ERROR", e.message, e)
    }
  }

  /** Read-only variant of getOrCreateCategory: resolves null if the category doesn't exist. */
  @ReactMethod
  fun findCategory(name: String, promise: Promise) {
    try {
      promise.resolve(queryCategoryUniqueAttributeByName(name))
    } catch (e: Exception) {
      promise.reject("KNOWLEDGE_BASE_ERROR", e.message, e)
    }
  }

  private fun queryCategoryUniqueAttributeByName(name: String): String? {
    val uri = Uri.withAppendedPath(BASE_URI, "knowledge_base/by_name")
    reactApplicationContext.contentResolver.query(uri, null, null, arrayOf(name), null)?.use {
        cursor ->
      if (cursor.moveToFirst()) {
        val col = cursor.getColumnIndex("unique_attribute")
        if (col >= 0) return cursor.getString(col)
      }
    }
    return null
  }

  private fun queryCategoryUniqueAttributeById(id: Long): String? {
    val uri = Uri.withAppendedPath(BASE_URI, "knowledge_base/by_id/$id")
    reactApplicationContext.contentResolver.query(uri, null, null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) {
        val col = cursor.getColumnIndex("unique_attribute")
        if (col >= 0) return cursor.getString(col)
      }
    }
    return null
  }

  /**
   * Creates a new Digest entry (shows up in the on-device Digest app's "Manual Entry" tab, under
   * the given category). `metadataJson`, if provided, should be a flat JSON object string (e.g.
   * `{"author":"..."}`) -- that's the exact format KnowledgeContentProvider expects for its
   * `metadata` column (see KnowledgeUtils.setMetadataStringValue in the decompiled source).
   */
  @ReactMethod
  fun insertEntry(
      content: String,
      categoryUniqueAttribute: String?,
      metadataJson: String?,
      promise: Promise,
  ) {
    try {
      val values = ContentValues()
      values.put("content", content)
      values.put("source_type", SOURCE_TYPE_SELF_ADD)
      if (!categoryUniqueAttribute.isNullOrEmpty()) {
        values.put("knowledge_base_unique_attribute", categoryUniqueAttribute)
      }
      if (!metadataJson.isNullOrEmpty()) {
        values.put("metadata", metadataJson)
      }

      val insertedUri =
          reactApplicationContext.contentResolver.insert(
              Uri.withAppendedPath(BASE_URI, "knowledge/insert"),
              values,
          )
      if (insertedUri == null) {
        promise.reject("KNOWLEDGE_INSERT_FAILED", "insert() returned null Uri")
        return
      }
      promise.resolve(ContentUris.parseId(insertedUri).toDouble())
    } catch (e: Exception) {
      promise.reject("KNOWLEDGE_INSERT_ERROR", e.message, e)
    }
  }

  /**
   * Lists all "Manual Entry" (source_type=4/SELF_ADD) Digest entries -- the bucket this module's
   * own `insertEntry` writes into, which is also where a user's own hand-typed Digest quotes
   * live (there's no other source_type a plugin can honestly use -- see docs/KNOWLEDGE_PROVIDER.md).
   * Used by Task 4 (export digest entries back to Readwise); the
   * Readwise-category filtering happens in JS (src/lib/digestSync.ts), not here.
   *
   * Queries the bare `knowledge` dir URI with a `selection` string -- see
   * docs/KNOWLEDGE_PROVIDER.md "Listing/filtering entries" for why this has to be a raw SQL
   * fragment (the provider does not apply `selectionArgs` as bind params on this particular
   * path). `SOURCE_TYPE_SELF_ADD` is a hardcoded int constant here, not user input, so this is
   * safe -- do not change this to build the selection string from any external input.
   */
  @ReactMethod
  fun queryManualEntries(promise: Promise) = queryBySourceType(SOURCE_TYPE_SELF_ADD, promise)

  /**
   * Same query for the other buckets: 1 = Documents (highlights made while reading a PDF/EPUB),
   * 2 = Notes (from a handwritten note). Rows additionally carry `sourcePath`/`sourcePage`, which
   * is where the JS side finds the file to read a title and author from. `sourceType` is an Int
   * from a fixed allow-list, never spliced in from arbitrary input (the selection is raw SQL --
   * see the note on queryManualEntries).
   */
  @ReactMethod
  fun queryEntriesBySourceType(sourceType: Int, promise: Promise) {
    if (sourceType !in 1..4) {
      promise.reject("KNOWLEDGE_BAD_SOURCE_TYPE", "source_type must be 1..4, got $sourceType")
      return
    }
    queryBySourceType(sourceType, promise)
  }

  private fun queryBySourceType(sourceType: Int, promise: Promise) {
    try {
      val results: WritableArray = Arguments.createArray()
      reactApplicationContext.contentResolver
          .query(
              Uri.withAppendedPath(BASE_URI, "knowledge"),
              null,
              "source_type = $sourceType",
              null,
              null,
          )
          ?.use { cursor ->
            fun str(name: String): String? {
              val i = cursor.getColumnIndex(name)
              return if (i >= 0) cursor.getString(i) else null
            }
            fun num(name: String): Double {
              val i = cursor.getColumnIndex(name)
              return if (i >= 0) cursor.getLong(i).toDouble() else 0.0
            }
            while (cursor.moveToNext()) {
              val row: WritableMap = Arguments.createMap()
              row.putDouble("id", num("id"))
              row.putString("content", str("content"))
              row.putString("categoryUniqueAttribute", str("knowledge_base_unique_attribute"))
              row.putString("metadata", str("metadata"))
              row.putDouble("creationTime", num("creation_time"))
              row.putInt("sourceType", sourceType)
              row.putString("sourcePath", str("source_path"))
              row.putString("sourcePage", str("source_page"))
              row.putString("comment", str("comment_str"))
              results.pushMap(row)
            }
          }
      promise.resolve(results)
    } catch (e: Exception) {
      promise.reject("KNOWLEDGE_QUERY_ERROR", e.message, e)
    }
  }
}
