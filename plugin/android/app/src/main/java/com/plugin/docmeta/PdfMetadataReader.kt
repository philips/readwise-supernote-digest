package com.plugin.docmeta

import java.io.ByteArrayOutputStream
import java.io.RandomAccessFile
import java.util.zip.Inflater

/**
 * Reads /Title and /Author from a PDF's Info dictionary without a PDF library.
 *
 * Path: last `startxref` -> xref section (classic table or xref stream, following /Prev through
 * incremental updates) -> trailer's /Info reference -> that object (plain, or inside an object
 * stream) -> string values. Only touches the tail of the file plus the few objects it needs, so
 * a 370 MB scan costs the same as a 60 KB paper.
 *
 * Deliberately gives up (returns null) on encrypted files rather than returning ciphertext, and
 * on anything structurally unexpected. Callers fall back to other sources.
 */
internal class PdfMetadataReader(private val raf: RandomAccessFile) {
  private val fileLength = raf.length()

  private sealed class Section {
    /** `first`..`first+count-1` -> 20-byte rows starting at `dataPos`. */
    class Table(val subsections: List<Triple<Int, Int, Long>>) : Section()

    class Stream(val index: List<Pair<Int, Int>>, val w: IntArray, val data: ByteArray) :
        Section()
  }

  private class Entry(val type: Int, val f2: Long, val f3: Long)

  fun read(): DocumentMetadata? =
      try {
        readUnsafe()
      } catch (_: IllegalArgumentException) {
        null // malformed structure
      } catch (_: java.io.EOFException) {
        null // truncated file
      }

  private fun readUnsafe(): DocumentMetadata? {
    val sections = ArrayList<Section>()
    var infoRef: PdfRef? = null

    var offset: Long? = findStartXref()
    val seen = HashSet<Long>()
    while (offset != null && offset in 0 until fileLength && seen.add(offset)) {
      val (section, trailer) = readSection(offset) ?: break
      sections.add(section)
      if (trailer.containsKey("Encrypt")) return null
      if (infoRef == null) infoRef = trailer["Info"] as? PdfRef
      offset = (trailer["Prev"] as? Long)
    }
    val ref = infoRef ?: return null

    val info = loadObject(ref.num, sections) as? Map<*, *> ?: return null
    val title = stringValue(info["Title"], sections)
    val author = stringValue(info["Author"], sections)
    if (title == null && author == null) return null
    return DocumentMetadata("pdf", title, if (author == null) emptyList() else listOf(author))
  }

  // -- locating the xref ---------------------------------------------------------------------

  private fun findStartXref(): Long? {
    val tailLen = minOf(8192L, fileLength).toInt()
    val tail = readBytes(fileLength - tailLen, tailLen)
    val text = String(tail, Charsets.ISO_8859_1)
    val at = text.lastIndexOf("startxref")
    if (at < 0) return null
    val lexer = PdfLexer(tail, at + "startxref".length)
    return lexer.parseValue() as? Long
  }

  private fun readSection(offset: Long): Pair<Section, Map<String, Any?>>? {
    val window = readBytes(offset, minOf(65536L, fileLength - offset).toInt())
    val lexer = PdfLexer(window, 0)
    lexer.skipWs()
    if (lexer.startsWith("xref")) return readTable(offset, window, lexer)
    return readXrefStream(offset, window, lexer)
  }

  private fun readTable(
      base: Long,
      window: ByteArray,
      lexer: PdfLexer,
  ): Pair<Section, Map<String, Any?>>? {
    lexer.pos += 4
    val subsections = ArrayList<Triple<Int, Int, Long>>()
    while (true) {
      lexer.skipWs()
      if (lexer.startsWith("trailer")) break
      val first = lexer.parseValue() as? Long ?: return null
      val count = lexer.parseValue() as? Long ?: return null
      lexer.skipWs()
      val dataPos = base + lexer.pos
      subsections.add(Triple(first.toInt(), count.toInt(), dataPos))
      val skip = count * 20
      if (lexer.pos + skip > window.size) {
        // Table larger than our window: re-read from just past it to find the trailer.
        val after = dataPos + skip
        val more = readBytes(after, minOf(65536L, fileLength - after).toInt())
        val l2 = PdfLexer(more, 0)
        l2.skipWs()
        if (!l2.startsWith("trailer")) return null
        l2.pos += "trailer".length
        val dict = l2.parseValue() as? Map<*, *> ?: return null
        return Pair(Section.Table(subsections), stringKeyed(dict))
      }
      lexer.pos += skip.toInt()
    }
    lexer.pos += "trailer".length
    val dict = lexer.parseValue() as? Map<*, *> ?: return null
    return Pair(Section.Table(subsections), stringKeyed(dict))
  }

  private fun readXrefStream(
      offset: Long,
      window: ByteArray,
      lexer: PdfLexer,
  ): Pair<Section, Map<String, Any?>>? {
    val obj = parseIndirectObject(offset, window, lexer, sections = emptyList()) ?: return null
    val dict = obj.dict
    val w = (dict["W"] as? List<*>)?.map { (it as? Long)?.toInt() ?: return null } ?: return null
    if (w.size != 3) return null
    val size = (dict["Size"] as? Long)?.toInt() ?: return null
    val index =
        (dict["Index"] as? List<*>)?.map { (it as? Long)?.toInt() ?: return null }?.chunked(2)
            ?.map { Pair(it[0], it[1]) } ?: listOf(Pair(0, size))
    val data = obj.decodedStream ?: return null
    return Pair(Section.Stream(index, w.toIntArray(), data), dict)
  }

  // -- looking up objects --------------------------------------------------------------------

  private fun lookup(num: Int, sections: List<Section>): Entry? {
    for (section in sections) {
      when (section) {
        is Section.Table ->
            for ((first, count, dataPos) in section.subsections) {
              if (num < first || num >= first + count) continue
              val row = readBytes(dataPos + (num - first) * 20L, 20)
              val lx = PdfLexer(row, 0)
              val off = lx.parseValue() as? Long ?: return null
              lx.parseValue()
              lx.skipWs()
              return when (row.getOrNull(lx.pos)?.toInt()?.toChar()) {
                'n' -> Entry(1, off, 0)
                else -> null // free => deleted
              }
            }
        is Section.Stream -> {
          var row = 0
          val rowLen = section.w.sum()
          for ((first, count) in section.index) {
            if (num >= first && num < first + count) {
              val at = (row + (num - first)) * rowLen
              if (at + rowLen > section.data.size) return null
              var p = at
              fun field(width: Int, default: Long): Long {
                if (width == 0) return default
                var v = 0L
                repeat(width) { v = (v shl 8) or (section.data[p++].toLong() and 0xff) }
                return v
              }
              val type = field(section.w[0], 1)
              val f2 = field(section.w[1], 0)
              val f3 = field(section.w[2], 0)
              return if (type == 0L) null else Entry(type.toInt(), f2, f3)
            }
            row += count
          }
        }
      }
    }
    return null
  }

  private class ParsedObject(
      val value: Any?,
      val dict: Map<String, Any?>,
      val decodedStream: ByteArray?,
  )

  /** Value of object [num] (dictionary/number/string/...), whether plain or in an object stream. */
  private fun loadObject(num: Int, sections: List<Section>): Any? {
    val entry = lookup(num, sections) ?: return null
    return when (entry.type) {
      1 -> {
        val window = readBytes(entry.f2, minOf(65536L, fileLength - entry.f2).toInt())
        parseIndirectObject(entry.f2, window, PdfLexer(window, 0), sections)?.value
      }
      2 -> loadFromObjectStream(entry.f2.toInt(), num, sections)
      else -> null
    }
  }

  private fun loadFromObjectStream(streamNum: Int, num: Int, sections: List<Section>): Any? {
    val e = lookup(streamNum, sections) ?: return null
    if (e.type != 1) return null
    val window = readBytes(e.f2, minOf(65536L, fileLength - e.f2).toInt())
    val obj = parseIndirectObject(e.f2, window, PdfLexer(window, 0), sections) ?: return null
    val data = obj.decodedStream ?: return null
    val n = (obj.dict["N"] as? Long)?.toInt() ?: return null
    val first = (obj.dict["First"] as? Long)?.toInt() ?: return null
    val header = PdfLexer(data, 0)
    for (i in 0 until n) {
      val objNum = header.parseValue() as? Long ?: return null
      val off = header.parseValue() as? Long ?: return null
      if (objNum.toInt() == num) return PdfLexer(data, first + off.toInt()).parseValue()
    }
    return null
  }

  private fun parseIndirectObject(
      offset: Long,
      window: ByteArray,
      lexer: PdfLexer,
      sections: List<Section>,
  ): ParsedObject? {
    lexer.skipWs()
    lexer.parseValue() as? Long ?: return null // object number
    lexer.parseValue() as? Long ?: return null // generation
    lexer.skipWs()
    if (!lexer.startsWith("obj")) return null
    lexer.pos += 3
    val value = lexer.parseValue()
    val dict = if (value is Map<*, *>) stringKeyed(value) else emptyMap()
    lexer.skipWs()
    var decoded: ByteArray? = null
    if (value is Map<*, *> && lexer.startsWith("stream")) {
      lexer.pos += 6
      if (window.getOrNull(lexer.pos)?.toInt() == 13) lexer.pos++
      if (window.getOrNull(lexer.pos)?.toInt() == 10) lexer.pos++
      val dataStart = offset + lexer.pos
      var length = dict["Length"]
      if (length is PdfRef) length = loadObject(length.num, sections)
      val len = (length as? Long)?.toInt() ?: return ParsedObject(value, dict, null)
      if (dataStart + len > fileLength) return ParsedObject(value, dict, null)
      decoded = decodeStream(dict, readBytes(dataStart, len))
    }
    return ParsedObject(value, dict, decoded)
  }

  // -- streams -------------------------------------------------------------------------------

  private fun decodeStream(dict: Map<String, Any?>, raw: ByteArray): ByteArray? {
    val filter =
        when (val f = dict["Filter"]) {
          is PdfName -> f.name
          is List<*> -> (f.firstOrNull() as? PdfName)?.name
          else -> null
        }
    if (filter == null) return raw
    if (filter != "FlateDecode" && filter != "Fl") return null
    val inflated = inflate(raw) ?: return null

    val parms =
        when (val p = dict["DecodeParms"]) {
          is Map<*, *> -> stringKeyed(p)
          is List<*> -> (p.firstOrNull() as? Map<*, *>)?.let { stringKeyed(it) }
          else -> null
        }
    val predictor = (parms?.get("Predictor") as? Long)?.toInt() ?: 1
    if (predictor < 10) return inflated
    val columns = (parms?.get("Columns") as? Long)?.toInt() ?: 1
    return undoPngPredictor(inflated, columns)
  }

  private fun inflate(raw: ByteArray): ByteArray? {
    val inflater = Inflater()
    return try {
      inflater.setInput(raw)
      val out = ByteArrayOutputStream()
      val buf = ByteArray(8192)
      while (!inflater.finished()) {
        val n = inflater.inflate(buf)
        if (n == 0 && (inflater.needsInput() || inflater.needsDictionary())) break
        out.write(buf, 0, n)
        if (out.size() > 64 * 1024 * 1024) return null // absurd for an xref/object stream
      }
      out.toByteArray()
    } catch (_: Exception) {
      null
    } finally {
      inflater.end()
    }
  }

  /** PNG row filters, one byte per pixel (all xref/object streams use 8-bit, 1 component). */
  private fun undoPngPredictor(data: ByteArray, columns: Int): ByteArray? {
    val rowLen = columns + 1
    if (rowLen <= 1 || data.size % rowLen != 0) return null
    val rows = data.size / rowLen
    val out = ByteArray(rows * columns)
    for (r in 0 until rows) {
      val filter = data[r * rowLen].toInt()
      for (c in 0 until columns) {
        val x = data[r * rowLen + 1 + c].toInt() and 0xff
        val left = if (c > 0) out[r * columns + c - 1].toInt() and 0xff else 0
        val up = if (r > 0) out[(r - 1) * columns + c].toInt() and 0xff else 0
        val upLeft = if (r > 0 && c > 0) out[(r - 1) * columns + c - 1].toInt() and 0xff else 0
        val v =
            when (filter) {
              0 -> x
              1 -> x + left
              2 -> x + up
              3 -> x + (left + up) / 2
              4 -> x + paeth(left, up, upLeft)
              else -> return null
            }
        out[r * columns + c] = v.toByte()
      }
    }
    return out
  }

  private fun paeth(a: Int, b: Int, c: Int): Int {
    val p = a + b - c
    val pa = Math.abs(p - a)
    val pb = Math.abs(p - b)
    val pc = Math.abs(p - c)
    return if (pa <= pb && pa <= pc) a else if (pb <= pc) b else c
  }

  // -- values --------------------------------------------------------------------------------

  private fun stringValue(v: Any?, sections: List<Section>): String? {
    val resolved = if (v is PdfRef) loadObject(v.num, sections) else v
    val bytes = (resolved as? PdfString)?.bytes ?: return null
    return decodeTextString(bytes).trim().replace("\u0000", "").ifEmpty { null }
  }

  private fun stringKeyed(map: Map<*, *>): Map<String, Any?> =
      map.entries.associate { (k, v) -> k as String to v }

  private fun readBytes(offset: Long, length: Int): ByteArray {
    val buf = ByteArray(maxOf(length, 0))
    raf.seek(offset)
    raf.readFully(buf)
    return buf
  }

  companion object {
    /** PDF "text string": UTF-16BE/LE with BOM, UTF-8 with BOM, else PDFDocEncoding (~Latin-1). */
    fun decodeTextString(b: ByteArray): String {
      if (b.size >= 2 && b[0] == 0xFE.toByte() && b[1] == 0xFF.toByte())
          return String(b, 2, b.size - 2, Charsets.UTF_16BE)
      if (b.size >= 2 && b[0] == 0xFF.toByte() && b[1] == 0xFE.toByte())
          return String(b, 2, b.size - 2, Charsets.UTF_16LE)
      if (b.size >= 3 && b[0] == 0xEF.toByte() && b[1] == 0xBB.toByte() && b[2] == 0xBF.toByte())
          return String(b, 3, b.size - 3, Charsets.UTF_8)
      return String(b, Charsets.ISO_8859_1)
    }
  }
}
