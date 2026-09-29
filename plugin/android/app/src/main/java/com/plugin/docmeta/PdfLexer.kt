package com.plugin.docmeta

internal class PdfName(val name: String)

internal class PdfString(val bytes: ByteArray)

internal class PdfRef(val num: Int, val gen: Int)

/**
 * Minimal PDF object parser over an in-memory window. Values: Long, Double, Boolean, null,
 * [PdfName], [PdfString], [PdfRef], List, Map<String, Any?> (dictionaries; keys without slash).
 * Throws [IllegalArgumentException] on malformed input; callers treat that as "no metadata".
 */
internal class PdfLexer(private val b: ByteArray, var pos: Int) {
  fun startsWith(s: String): Boolean {
    if (pos + s.length > b.size) return false
    for (i in s.indices) if (b[pos + i].toInt().toChar() != s[i]) return false
    return true
  }

  fun skipWs() {
    while (pos < b.size) {
      val c = b[pos].toInt() and 0xff
      if (isWs(c)) pos++
      else if (c == '%'.code) {
        while (pos < b.size && b[pos].toInt() != 10 && b[pos].toInt() != 13) pos++
      } else break
    }
  }

  fun parseValue(): Any? {
    skipWs()
    require(pos < b.size) { "eof" }
    val c = b[pos].toInt().toChar()
    return when {
      c == '/' -> parseName()
      c == '(' -> parseLiteralString()
      c == '<' -> if (pos + 1 < b.size && b[pos + 1].toInt().toChar() == '<') parseDict() else parseHexString()
      c == '[' -> parseArray()
      c == '-' || c == '+' || c == '.' || c.isDigit() -> parseNumberOrRef()
      startsWith("true") -> { pos += 4; true }
      startsWith("false") -> { pos += 5; false }
      startsWith("null") -> { pos += 4; null }
      else -> throw IllegalArgumentException("unexpected '$c' at $pos")
    }
  }

  private fun parseName(): PdfName {
    pos++ // '/'
    val sb = StringBuilder()
    while (pos < b.size) {
      val c = b[pos].toInt() and 0xff
      if (isWs(c) || isDelimiter(c)) break
      if (c == '#'.code && pos + 2 < b.size) {
        val hex = String(b, pos + 1, 2, Charsets.ISO_8859_1).toIntOrNull(16)
        if (hex != null) {
          sb.append(hex.toChar())
          pos += 3
          continue
        }
      }
      sb.append(c.toChar())
      pos++
    }
    return PdfName(sb.toString())
  }

  private fun parseNumberOrRef(): Any {
    val start = pos
    while (pos < b.size) {
      val c = b[pos].toInt().toChar()
      if (c.isDigit() || c == '-' || c == '+' || c == '.') pos++ else break
    }
    val text = String(b, start, pos - start, Charsets.ISO_8859_1)
    val asLong = text.toLongOrNull()
    if (asLong == null) return text.toDoubleOrNull() ?: throw IllegalArgumentException("bad number '$text'")
    if (asLong < 0 || text.startsWith("+")) return asLong

    // "12 0 R" -- look ahead for generation + R.
    val save = pos
    skipWs()
    val genStart = pos
    while (pos < b.size && b[pos].toInt().toChar().isDigit()) pos++
    if (pos > genStart) {
      val gen = String(b, genStart, pos - genStart, Charsets.ISO_8859_1).toIntOrNull()
      skipWs()
      if (gen != null && pos < b.size && b[pos].toInt().toChar() == 'R') {
        val after = pos + 1
        if (after >= b.size || isWs(b[after].toInt() and 0xff) || isDelimiter(b[after].toInt() and 0xff)) {
          pos = after
          return PdfRef(asLong.toInt(), gen)
        }
      }
    }
    pos = save
    return asLong
  }

  private fun parseLiteralString(): PdfString {
    pos++ // '('
    val out = java.io.ByteArrayOutputStream()
    var depth = 1
    while (pos < b.size) {
      val c = b[pos].toInt() and 0xff
      pos++
      when (c) {
        '\\'.code -> {
          require(pos < b.size) { "eof in string" }
          val e = b[pos].toInt().toChar()
          pos++
          when (e) {
            'n' -> out.write(10)
            'r' -> out.write(13)
            't' -> out.write(9)
            'b' -> out.write(8)
            'f' -> out.write(12)
            '(', ')', '\\' -> out.write(e.code)
            '\r' -> if (pos < b.size && b[pos].toInt() == 10) pos++
            '\n' -> {}
            in '0'..'7' -> {
              var v = e - '0'
              var digits = 1
              while (digits < 3 && pos < b.size && b[pos].toInt().toChar() in '0'..'7') {
                v = v * 8 + (b[pos].toInt().toChar() - '0')
                pos++
                digits++
              }
              out.write(v and 0xff)
            }
            else -> out.write(e.code)
          }
        }
        '('.code -> { depth++; out.write(c) }
        ')'.code -> {
          depth--
          if (depth == 0) return PdfString(out.toByteArray())
          out.write(c)
        }
        else -> out.write(c)
      }
    }
    throw IllegalArgumentException("unterminated string")
  }

  private fun parseHexString(): PdfString {
    pos++ // '<'
    val out = java.io.ByteArrayOutputStream()
    var high = -1
    while (pos < b.size) {
      val c = b[pos].toInt().toChar()
      pos++
      if (c == '>') {
        if (high >= 0) out.write(high shl 4)
        return PdfString(out.toByteArray())
      }
      val d = Character.digit(c, 16)
      if (d < 0) continue // whitespace
      if (high < 0) high = d else { out.write((high shl 4) or d); high = -1 }
    }
    throw IllegalArgumentException("unterminated hex string")
  }

  private fun parseArray(): List<Any?> {
    pos++ // '['
    val list = ArrayList<Any?>()
    while (true) {
      skipWs()
      require(pos < b.size) { "eof in array" }
      if (b[pos].toInt().toChar() == ']') { pos++; return list }
      list.add(parseValue())
    }
  }

  private fun parseDict(): Map<String, Any?> {
    pos += 2 // '<<'
    val map = LinkedHashMap<String, Any?>()
    while (true) {
      skipWs()
      require(pos < b.size) { "eof in dict" }
      if (startsWith(">>")) { pos += 2; return map }
      val key = parseValue() as? PdfName ?: throw IllegalArgumentException("dict key not a name")
      map[key.name] = parseValue()
    }
  }

  private fun isWs(c: Int) = c == 0 || c == 9 || c == 10 || c == 12 || c == 13 || c == 32

  private fun isDelimiter(c: Int) =
      c == '('.code || c == ')'.code || c == '<'.code || c == '>'.code || c == '['.code ||
          c == ']'.code || c == '{'.code || c == '}'.code || c == '/'.code || c == '%'.code
}
