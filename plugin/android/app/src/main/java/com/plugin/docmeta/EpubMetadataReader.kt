package com.plugin.docmeta

import java.io.File
import java.io.InputStream
import java.util.zip.ZipFile
import javax.xml.parsers.DocumentBuilderFactory
import org.w3c.dom.Element
import org.w3c.dom.Node
import org.xml.sax.InputSource

/**
 * EPUB = zip. META-INF/container.xml names the OPF package document, whose <metadata> block has
 * dc:title and dc:creator. Opens the zip via its central directory, so a 350 MB comic EPUB costs
 * the same as a 50 KB one.
 */
internal object EpubMetadataReader {
  private const val DC_NS = "http://purl.org/dc/elements/1.1/"
  private const val OPF_NS = "http://www.idpf.org/2007/opf"

  fun read(file: File): DocumentMetadata? {
    ZipFile(file).use { zip ->
      val containerEntry = zip.getEntry("META-INF/container.xml") ?: return null
      val container = zip.getInputStream(containerEntry).use { parse(it) } ?: return null
      val opfPath = findRootfile(container) ?: return null

      val opfEntry = zip.getEntry(opfPath) ?: zip.getEntry(decodeUrl(opfPath)) ?: return null
      val opf = zip.getInputStream(opfEntry).use { parse(it) } ?: return null
      return extract(opf)
    }
  }

  private fun parse(stream: InputStream): org.w3c.dom.Document? {
    val factory = DocumentBuilderFactory.newInstance()
    factory.isNamespaceAware = true
    factory.isExpandEntityReferences = false
    // Not every JAXP implementation (Android's included) supports every hardening feature.
    for (feature in listOf(
        "http://apache.org/xml/features/disallow-doctype-decl",
        "http://xml.org/sax/features/external-general-entities",
        "http://xml.org/sax/features/external-parameter-entities",
    )) {
      try {
        factory.setFeature(feature, feature.endsWith("disallow-doctype-decl"))
      } catch (_: Exception) {}
    }
    val builder = factory.newDocumentBuilder()
    // Whatever the parser does with a DOCTYPE, never fetch anything.
    builder.setEntityResolver { _, _ -> InputSource(java.io.StringReader("")) }
    return try {
      builder.parse(stream)
    } catch (_: Exception) {
      null
    }
  }

  private fun findRootfile(container: org.w3c.dom.Document): String? {
    val nodes = container.getElementsByTagNameNS("*", "rootfile")
    for (i in 0 until nodes.length) {
      val path = (nodes.item(i) as Element).getAttribute("full-path")
      if (path.isNotBlank()) return path
    }
    return null
  }

  private fun extract(opf: org.w3c.dom.Document): DocumentMetadata? {
    var title: String? = null
    val authors = ArrayList<String>()

    val metadataNodes = opf.getElementsByTagNameNS("*", "metadata")
    if (metadataNodes.length == 0) return null
    val metadata = metadataNodes.item(0)
    var child: Node? = metadata.firstChild
    while (child != null) {
      if (child is Element && (child.namespaceURI == DC_NS || child.namespaceURI == null)) {
        val text = child.textContent?.trim().orEmpty()
        when (child.localName ?: child.nodeName.substringAfter(':')) {
          "title" -> if (title == null && text.isNotEmpty()) title = text
          "creator" -> {
            // opf:role="aut" (or none) is an author; "ill" (illustrator), "trl" etc. are not.
            val role =
                child.getAttributeNS(OPF_NS, "role").ifEmpty { child.getAttribute("opf:role") }
            if (text.isNotEmpty() && (role.isEmpty() || role == "aut")) authors.add(text)
          }
        }
      }
      child = child.nextSibling
    }
    if (title == null && authors.isEmpty()) return null
    return DocumentMetadata("epub", title, authors)
  }

  private fun decodeUrl(path: String): String =
      try {
        java.net.URLDecoder.decode(path.replace("+", "%2B"), "UTF-8")
      } catch (_: Exception) {
        path
      }
}
