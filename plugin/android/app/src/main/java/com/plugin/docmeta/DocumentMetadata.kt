package com.plugin.docmeta

import java.io.File
import java.io.RandomAccessFile

/**
 * Title/author read out of a document file itself. Pure JVM (no Android APIs) so it can be
 * unit-tested on the host -- see app/src/test.
 */
data class DocumentMetadata(
    val format: String, // "pdf" | "epub"
    val title: String?,
    val authors: List<String>,
    /** PDF only: the document's XMP `dc:title` / `dc:creator`, kept separate from the Info
     * dictionary values above so the caller can fall through when one of them is junk (an Info
     * title of "Microsoft Word - x.doc" next to a good XMP title, or the reverse). */
    val xmpTitle: String? = null,
    val xmpAuthors: List<String> = emptyList(),
)

object DocumentMetadataReader {
  /** Returns null when the file is neither a readable PDF nor EPUB, or has no usable metadata
   * (encrypted PDF, no Info dictionary, ...). Throws only on unexpected I/O failures. */
  fun read(file: File): DocumentMetadata? {
    val format = sniff(file) ?: return null
    return when (format) {
      "pdf" -> RandomAccessFile(file, "r").use { PdfMetadataReader(it).read() }
      else -> EpubMetadataReader.read(file)
    }
  }

  /** Magic bytes first (files on the device are sometimes misnamed), extension as a tiebreaker. */
  private fun sniff(file: File): String? {
    val head = ByteArray(1024)
    val n = RandomAccessFile(file, "r").use { it.read(head) }
    if (n <= 0) return null
    val text = String(head, 0, n, Charsets.ISO_8859_1)
    if (text.contains("%PDF-")) return "pdf"
    if (head[0] == 'P'.code.toByte() && head[1] == 'K'.code.toByte()) {
      return if (file.name.endsWith(".epub", ignoreCase = true)) "epub" else null
    }
    return null
  }
}
