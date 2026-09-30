package com.plugin

import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.plugin.docmeta.DocumentMetadataReader
import java.io.File

/**
 * Reads title/author out of PDF and EPUB files, so Digest entries from Documents can be exported
 * to Readwise under the real book title instead of a filename. The parsing itself lives in
 * com.plugin.docmeta (pure JVM, unit-tested); this class is only the React Native bridge.
 *
 * Read-only: opens the given file, returns a few strings. Policy (what to do when the file has no
 * usable metadata, caching, filename fallback) is in src/lib/documentInfo/ on the JS side.
 */
class DocumentMetadataModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "DocumentMetadata"

  /**
   * Always resolves (never rejects) so the JS side can treat any failure as "no metadata":
   * `{exists, size, mtime, format?, title?, authors?, error?}`. size/mtime let the caller cache
   * results and notice when the file changes.
   */
  @ReactMethod
  fun readMetadata(path: String, promise: Promise) {
    val out = Arguments.createMap()
    try {
      val file = File(path)
      if (!file.isFile) {
        out.putBoolean("exists", false)
        promise.resolve(out)
        return
      }
      out.putBoolean("exists", true)
      out.putDouble("size", file.length().toDouble())
      out.putDouble("mtime", file.lastModified().toDouble())
      val meta = DocumentMetadataReader.read(file)
      if (meta != null) {
        out.putString("format", meta.format)
        if (meta.title != null) out.putString("title", meta.title)
        val authors = Arguments.createArray()
        meta.authors.forEach { authors.pushString(it) }
        out.putArray("authors", authors)
        if (meta.xmpTitle != null) out.putString("xmpTitle", meta.xmpTitle)
        val xmpAuthors = Arguments.createArray()
        meta.xmpAuthors.forEach { xmpAuthors.pushString(it) }
        out.putArray("xmpAuthors", xmpAuthors)
      }
    } catch (e: Throwable) {
      out.putString("error", "${e.javaClass.simpleName}: ${e.message}")
    }
    promise.resolve(out)
  }

}
