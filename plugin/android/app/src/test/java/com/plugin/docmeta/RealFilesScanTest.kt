package com.plugin.docmeta

import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Opt-in: point DOCMETA_DIR at a folder of real PDFs/EPUBs and DOCMETA_OUT at a file to get a TSV
 * of what the reader extracts, for eyeballing against reality. Skipped in normal runs.
 *
 *   DOCMETA_DIR=/tmp/docs DOCMETA_OUT=/tmp/scan.tsv ./gradlew :app:testDebugUnitTest --tests '*RealFilesScanTest'
 */
class RealFilesScanTest {
  @Test fun scan() {
    val dir = System.getenv("DOCMETA_DIR")
    assumeTrue(dir != null)
    val out = File(System.getenv("DOCMETA_OUT") ?: "/tmp/docmeta_scan.tsv")
    val lines = StringBuilder()
    for (f in File(dir!!).listFiles()!!.sortedBy { it.name }) {
      val started = System.nanoTime()
      val result =
          try {
            DocumentMetadataReader.read(f)?.let {
              "${it.format}\t${it.title ?: ""}\t${it.authors.joinToString(" | ")}"
            } ?: "-\t\t"
          } catch (e: Throwable) {
            "ERROR\t${e.javaClass.simpleName}: ${e.message}\t"
          }
      val ms = (System.nanoTime() - started) / 1_000_000
      lines.append("${f.name}\t${ms}ms\t$result\n")
    }
    out.writeText(lines.toString())
  }
}
