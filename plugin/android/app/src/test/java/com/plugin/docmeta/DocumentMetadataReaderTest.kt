package com.plugin.docmeta

import java.io.ByteArrayOutputStream
import java.io.File
import java.util.zip.Deflater
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

/** Builds tiny PDFs/EPUBs byte by byte so the parsers are tested against known structure. */
class DocumentMetadataReaderTest {
  @get:Rule val tmp = TemporaryFolder()

  // ---- PDF fixture builder ---------------------------------------------------------------

  private class Pdf {
    val out = ByteArrayOutputStream()
    val offsets = LinkedHashMap<Int, Int>()

    fun raw(s: String) = out.write(s.toByteArray(Charsets.ISO_8859_1))

    fun raw(b: ByteArray) = out.write(b)

    init {
      raw("%PDF-1.5\n%\u00e2\u00e3\u00cf\u00d3\n")
    }

    fun obj(num: Int, body: String) {
      offsets[num] = out.size()
      raw("$num 0 obj\n$body\nendobj\n")
    }

    fun streamObj(num: Int, dict: String, data: ByteArray) {
      offsets[num] = out.size()
      raw("$num 0 obj\n<< $dict /Length ${data.size} >>\nstream\n")
      raw(data)
      raw("\nendstream\nendobj\n")
    }

    /** Classic table covering objects 0..size-1 (unlisted ones are free). Returns its offset. */
    fun classicXref(size: Int, trailer: String): Int {
      val pos = out.size()
      raw("xref\n0 $size\n")
      for (i in 0 until size) {
        val off = offsets[i]
        raw(if (off == null) "0000000000 65535 f \n" else String.format("%010d 00000 n \n", off))
      }
      raw("trailer\n<< /Size $size $trailer >>\nstartxref\n$pos\n%%EOF\n")
      return pos
    }
  }

  private fun deflate(b: ByteArray): ByteArray {
    val d = Deflater()
    d.setInput(b)
    d.finish()
    val out = ByteArrayOutputStream()
    val buf = ByteArray(1024)
    while (!d.finished()) out.write(buf, 0, d.deflate(buf))
    d.end()
    return out.toByteArray()
  }

  /** PNG "Up" predictor (filter 2), as real xref streams use (/Predictor 12). */
  private fun pngUp(data: ByteArray, columns: Int): ByteArray {
    val out = ByteArrayOutputStream()
    val rows = data.size / columns
    for (r in 0 until rows) {
      out.write(2)
      for (c in 0 until columns) {
        val up = if (r > 0) data[(r - 1) * columns + c].toInt() and 0xff else 0
        out.write(((data[r * columns + c].toInt() and 0xff) - up) and 0xff)
      }
    }
    return out.toByteArray()
  }

  private fun xrefRow(type: Int, f2: Int, f3: Int) =
      byteArrayOf(
          type.toByte(),
          (f2 shr 24).toByte(), (f2 shr 16).toByte(), (f2 shr 8).toByte(), f2.toByte(),
          (f3 shr 8).toByte(), f3.toByte(),
      )

  private fun write(name: String, bytes: ByteArray): File {
    val dir = tmp.newFolder() // unique per call so a test can build several files
    return File(dir, name).also { it.writeBytes(bytes) }
  }

  private fun pdfWithInfo(info: String): File {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog /Pages 2 0 R >>")
    pdf.obj(2, "<< /Type /Pages /Kids [] /Count 0 >>")
    pdf.obj(3, info)
    pdf.classicXref(4, "/Root 1 0 R /Info 3 0 R")
    return write("t.pdf", pdf.out.toByteArray())
  }

  private fun read(f: File) = DocumentMetadataReader.read(f)

  // ---- PDF: classic xref ------------------------------------------------------------------

  @Test fun pdfClassicPlainInfo() {
    val m = read(pdfWithInfo("<< /Title (Concrete Mathematics) /Author (Donald E. Knuth) /Producer (x) >>"))!!
    assertEquals("pdf", m.format)
    assertEquals("Concrete Mathematics", m.title)
    assertEquals(listOf("Donald E. Knuth"), m.authors)
  }

  @Test fun pdfLiteralStringEscapesAndNestedParens() {
    val m = read(pdfWithInfo("<< /Title (A \\(nested (parens)\\) \\\\ back\\nslash \\101\\102) >>"))!!
    assertEquals("A (nested (parens)) \\ back\nslash AB", m.title)
  }

  @Test fun pdfLiteralStringLineContinuation() {
    val m = read(pdfWithInfo("<< /Title (one\\\ntwo) >>"))!!
    assertEquals("onetwo", m.title)
  }

  @Test fun pdfUtf16HexString() {
    // FEFF + "Ünï" / "Ada" in UTF-16BE; whitespace inside hex strings is ignored
    val m = read(pdfWithInfo("<< /Title <FEFF 00DC 006E 00EF> /Author <FEFF004100640061> >>"))!!
    assertEquals("\u00dcn\u00ef", m.title)
    assertEquals(listOf("Ada"), m.authors)
  }

  @Test fun pdfUtf16LiteralWithBom() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.offsets[3] = pdf.out.size()
    pdf.raw("3 0 obj\n<< /Title (")
    pdf.raw(byteArrayOf(0xFE.toByte(), 0xFF.toByte(), 0x00, 0x48, 0x00, 0x69))
    pdf.raw(") >>\nendobj\n")
    pdf.classicXref(4, "/Root 1 0 R /Info 3 0 R")
    assertEquals("Hi", read(write("u.pdf", pdf.out.toByteArray()))!!.title)
  }

  @Test fun pdfPdfDocEncodingLatin1() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.offsets[3] = pdf.out.size()
    pdf.raw("3 0 obj\n<< /Author (Andr")
    pdf.raw(byteArrayOf(0xE9.toByte()))
    pdf.raw(") >>\nendobj\n")
    pdf.classicXref(4, "/Root 1 0 R /Info 3 0 R")
    assertEquals(listOf("Andr\u00e9"), read(write("l.pdf", pdf.out.toByteArray()))!!.authors)
  }

  @Test fun pdfTitleOnlyAndAuthorOnly() {
    assertEquals(emptyList<String>(), read(pdfWithInfo("<< /Title (Only Title) >>"))!!.authors)
    assertNull(read(pdfWithInfo("<< /Author (Only Author) >>"))!!.title)
  }

  @Test fun pdfBlankStringsAreNull() {
    assertNull(read(pdfWithInfo("<< /Title (   ) /Author () >>")))
  }

  @Test fun pdfIndirectStringValue() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.obj(3, "<< /Title 4 0 R >>")
    pdf.obj(4, "(Indirect Title)")
    pdf.classicXref(5, "/Root 1 0 R /Info 3 0 R")
    assertEquals("Indirect Title", read(write("i.pdf", pdf.out.toByteArray()))!!.title)
  }

  @Test fun pdfNoInfoReference() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.classicXref(2, "/Root 1 0 R")
    assertNull(read(write("n.pdf", pdf.out.toByteArray())))
  }

  @Test fun pdfEncryptedIsRefused() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.obj(3, "<< /Title <DEADBEEF> >>")
    pdf.obj(4, "<< /Filter /Standard >>")
    pdf.classicXref(5, "/Root 1 0 R /Info 3 0 R /Encrypt 4 0 R")
    assertNull(read(write("e.pdf", pdf.out.toByteArray())))
  }

  @Test fun pdfFreedInfoObjectIsIgnored() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    // object 3 deliberately absent from offsets => marked free in the table
    pdf.classicXref(4, "/Root 1 0 R /Info 3 0 R")
    assertNull(read(write("f.pdf", pdf.out.toByteArray())))
  }

  @Test fun pdfIncrementalUpdateNewestInfoWins() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.obj(3, "<< /Title (Old Title) /Author (Old Author) >>")
    val first = pdf.classicXref(4, "/Root 1 0 R /Info 3 0 R")
    // Update: rewrite object 3, new xref section with just that object, /Prev to the old one.
    pdf.offsets[3] = pdf.out.size()
    pdf.raw("3 0 obj\n<< /Title (New Title) /Author (New Author) >>\nendobj\n")
    val pos = pdf.out.size()
    pdf.raw("xref\n3 1\n${String.format("%010d 00000 n \n", pdf.offsets[3])}")
    pdf.raw("trailer\n<< /Size 4 /Root 1 0 R /Info 3 0 R /Prev $first >>\nstartxref\n$pos\n%%EOF\n")
    val m = read(write("inc.pdf", pdf.out.toByteArray()))!!
    assertEquals("New Title", m.title)
    assertEquals(listOf("New Author"), m.authors)
  }

  @Test fun pdfIncrementalUpdateFallsBackToPrevForUntouchedObjects() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.obj(3, "<< /Title (Kept) >>")
    val first = pdf.classicXref(4, "/Root 1 0 R /Info 3 0 R")
    pdf.obj(1, "<< /Type /Catalog /Extra true >>")
    val pos = pdf.out.size()
    pdf.raw("xref\n1 1\n${String.format("%010d 00000 n \n", pdf.offsets[1])}")
    pdf.raw("trailer\n<< /Size 4 /Root 1 0 R /Prev $first >>\nstartxref\n$pos\n%%EOF\n")
    // The new trailer omits /Info; the original one is still the valid Info reference.
    assertEquals("Kept", read(write("inc2.pdf", pdf.out.toByteArray()))!!.title)
  }

  // ---- PDF: xref streams / object streams ------------------------------------------------

  @Test fun pdfXrefStreamWithPredictorAndInfoInObjectStream() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")

    // Object stream 4 holds object 5 (the Info dict).
    val infoText = "<< /Title (Packed Title) /Author (Packed Author) >>"
    val header = "5 0 "
    val objStm = deflate((header + infoText).toByteArray())
    pdf.streamObj(4, "/Type /ObjStm /N 1 /First ${header.length} /Filter /FlateDecode", objStm)

    // Xref stream is object 6: rows for objects 0..6.
    val xrefPos = pdf.out.size()
    val rows = ByteArrayOutputStream()
    rows.write(xrefRow(0, 0, 65535))
    rows.write(xrefRow(1, pdf.offsets[1]!!, 0))
    rows.write(xrefRow(0, 0, 0)) // 2 free
    rows.write(xrefRow(0, 0, 0)) // 3 free
    rows.write(xrefRow(1, pdf.offsets[4]!!, 0))
    rows.write(xrefRow(2, 4, 0)) // 5 -> in objstm 4, index 0
    rows.write(xrefRow(1, xrefPos, 0))
    val data = deflate(pngUp(rows.toByteArray(), 7))
    pdf.raw("6 0 obj\n<< /Type /XRef /Size 7 /W [1 4 2] /Root 1 0 R /Info 5 0 R " +
        "/Filter /FlateDecode /DecodeParms << /Predictor 12 /Columns 7 >> /Length ${data.size} >>\nstream\n")
    pdf.raw(data)
    pdf.raw("\nendstream\nendobj\nstartxref\n$xrefPos\n%%EOF\n")

    val m = read(write("xs.pdf", pdf.out.toByteArray()))!!
    assertEquals("Packed Title", m.title)
    assertEquals(listOf("Packed Author"), m.authors)
  }

  @Test fun pdfXrefStreamWithoutPredictorPlainInfo() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    pdf.obj(2, "<< /Title (Plain via xref stream) >>")
    val xrefPos = pdf.out.size()
    val rows = ByteArrayOutputStream()
    rows.write(xrefRow(0, 0, 65535))
    rows.write(xrefRow(1, pdf.offsets[1]!!, 0))
    rows.write(xrefRow(1, pdf.offsets[2]!!, 0))
    rows.write(xrefRow(1, xrefPos, 0))
    val data = deflate(rows.toByteArray())
    pdf.raw("3 0 obj\n<< /Type /XRef /Size 4 /W [1 4 2] /Root 1 0 R /Info 2 0 R " +
        "/Filter /FlateDecode /Length ${data.size} >>\nstream\n")
    pdf.raw(data)
    pdf.raw("\nendstream\nendobj\nstartxref\n$xrefPos\n%%EOF\n")
    assertEquals("Plain via xref stream", read(write("xs2.pdf", pdf.out.toByteArray()))!!.title)
  }

  // ---- PDF: robustness --------------------------------------------------------------------

  @Test fun pdfTruncatedFile() {
    val full = pdfWithInfo("<< /Title (T) >>").readBytes()
    assertNull(read(write("trunc.pdf", full.copyOf(full.size / 2))))
  }

  @Test fun pdfGarbageAfterHeader() {
    assertNull(read(write("g.pdf", "%PDF-1.4\nthis is not a pdf at all".toByteArray())))
  }

  @Test fun pdfStartxrefPointsToGarbage() {
    val bytes = "%PDF-1.4\n<< nothing >>\nstartxref\n5\n%%EOF\n".toByteArray()
    assertNull(read(write("bad.pdf", bytes)))
  }

  @Test fun pdfXrefLoopTerminates() {
    val pdf = Pdf()
    pdf.obj(1, "<< /Type /Catalog >>")
    val pos = pdf.out.size()
    pdf.raw("xref\n0 2\n0000000000 65535 f \n${String.format("%010d 00000 n \n", pdf.offsets[1])}")
    pdf.raw("trailer\n<< /Size 2 /Root 1 0 R /Prev $pos >>\nstartxref\n$pos\n%%EOF\n")
    assertNull(read(write("loop.pdf", pdf.out.toByteArray())))
  }

  @Test fun pdfWithJunkBeforeStartxrefTailIsFound() {
    val f = pdfWithInfo("<< /Title (Tail) >>")
    f.appendBytes(ByteArray(3000) { ' '.code.toByte() })
    assertEquals("Tail", read(f)!!.title)
  }

  @Test fun pdfLexerNameEscapesAndComments() {
    val m = read(pdfWithInfo("<< % a comment\n /Ti#74le (Escaped key) >>"))!!
    assertEquals("Escaped key", m.title)
  }

  // ---- Format sniffing --------------------------------------------------------------------

  @Test fun nonDocumentFilesAreIgnored() {
    assertNull(read(write("a.txt", "just text".toByteArray())))
    assertNull(read(write("empty.pdf", ByteArray(0))))
  }

  @Test fun pdfMisnamedAsEpubIsStillReadAsPdf() {
    val bytes = pdfWithInfo("<< /Title (Misnamed) >>").readBytes()
    assertEquals("Misnamed", read(write("really-a-pdf.epub", bytes))!!.title)
  }

  @Test fun zipThatIsNotAnEpubIsIgnored() {
    val bytes = zip("data.txt" to "hi".toByteArray())
    assertNull(read(write("notepub.zip", bytes)))
  }

  // ---- EPUB -------------------------------------------------------------------------------

  private fun zip(vararg entries: Pair<String, ByteArray>): ByteArray {
    val out = ByteArrayOutputStream()
    ZipOutputStream(out).use { z ->
      for ((name, data) in entries) {
        z.putNextEntry(ZipEntry(name))
        z.write(data)
        z.closeEntry()
      }
    }
    return out.toByteArray()
  }

  private fun container(opfPath: String = "OEBPS/content.opf") =
      """<?xml version="1.0"?>
      <container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
        <rootfiles><rootfile full-path="$opfPath" media-type="application/oebps-package+xml"/></rootfiles>
      </container>""".toByteArray()

  private fun opf(metadataInner: String, prolog: String = "") =
      """<?xml version="1.0" encoding="utf-8"?>$prolog
      <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
          $metadataInner
        </metadata>
      </package>""".toByteArray()

  private fun epub(opfBytes: ByteArray, opfPath: String = "OEBPS/content.opf", name: String = "b.epub") =
      write(
          name,
          zip(
              "mimetype" to "application/epub+zip".toByteArray(),
              "META-INF/container.xml" to container(opfPath),
              opfPath to opfBytes,
          ),
      )

  @Test fun epubTitleAndAuthor() {
    val m = read(epub(opf("<dc:title>Winnie-the-Pooh</dc:title><dc:creator>A. A. Milne</dc:creator>")))!!
    assertEquals("epub", m.format)
    assertEquals("Winnie-the-Pooh", m.title)
    assertEquals(listOf("A. A. Milne"), m.authors)
  }

  @Test fun epubMultipleAuthorsKeepOrder() {
    val m = read(epub(opf("<dc:title>T</dc:title><dc:creator>First</dc:creator><dc:creator>Second</dc:creator>")))!!
    assertEquals(listOf("First", "Second"), m.authors)
  }

  @Test fun epubOnlyAuthorRolesCount() {
    val m = read(epub(opf("""<dc:title>T</dc:title>
      <dc:creator opf:role="aut">Writer</dc:creator>
      <dc:creator opf:role="ill">Illustrator</dc:creator>
      <dc:creator opf:role="trl">Translator</dc:creator>
      <dc:creator>No Role</dc:creator>""")))!!
    assertEquals(listOf("Writer", "No Role"), m.authors)
  }

  @Test fun epubFirstTitleWins() {
    val m = read(epub(opf("<dc:title>Main</dc:title><dc:title>Subtitle</dc:title>")))!!
    assertEquals("Main", m.title)
  }

  @Test fun epubWhitespaceAndBlankValues() {
    val m = read(epub(opf("<dc:title>\n   Padded Title  \n</dc:title><dc:creator>   </dc:creator>")))!!
    assertEquals("Padded Title", m.title)
    assertEquals(emptyList<String>(), m.authors)
  }

  @Test fun epubEntitiesAndUnicode() {
    val m = read(epub(opf("<dc:title>Fables &amp; Tales \u2014 \u00c6sop</dc:title>")))!!
    assertEquals("Fables & Tales \u2014 \u00c6sop", m.title)
  }

  @Test fun epubWithoutMetadataElementsIsNull() {
    assertNull(read(epub(opf("<dc:language>en</dc:language>"))))
  }

  @Test fun epubOpfInRootAndUrlEncodedPath() {
    val f = epub(opf("<dc:title>Root OPF</dc:title>"), opfPath = "content.opf")
    assertEquals("Root OPF", read(f)!!.title)

    val g =
        write(
            "enc.epub",
            zip(
                "META-INF/container.xml" to container("OEBPS/my%20book.opf"),
                "OEBPS/my book.opf" to opf("<dc:title>Spaces</dc:title>"),
            ),
        )
    assertEquals("Spaces", read(g)!!.title)
  }

  @Test fun epubMissingContainerOrOpf() {
    assertNull(read(write("nc.epub", zip("mimetype" to "application/epub+zip".toByteArray()))))
    val noOpf = write("no-opf.epub", zip("META-INF/container.xml" to container("missing.opf")))
    assertNull(read(noOpf))
  }

  @Test fun epubMalformedXmlIsNullNotACrash() {
    assertNull(read(epub("<package><metadata><dc:title>oops".toByteArray())))
  }

  @Test fun epubExternalEntityIsNotResolved() {
    val secret = tmp.newFile("secret.txt").also { it.writeText("TOP-SECRET") }
    val prolog =
        """<!DOCTYPE package [<!ENTITY xxe SYSTEM "file://${secret.absolutePath}">]>"""
    val m = read(epub(opf("<dc:title>&xxe;</dc:title><dc:creator>Someone</dc:creator>", prolog)))
    // Either rejected outright or parsed with the entity empty -- but never the file's contents.
    assertNotNull(m?.title ?: "rejected")
    assertEquals(false, (m?.title ?: "").contains("TOP-SECRET"))
  }
}
