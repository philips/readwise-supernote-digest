package com.plugin.docmeta

import java.io.ByteArrayInputStream
import org.w3c.dom.Element

/**
 * Title and creators from an XMP packet (the `/Metadata` stream of a PDF catalog):
 *
 *   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">The Title</rdf:li></rdf:Alt></dc:title>
 *   <dc:creator><rdf:Seq><rdf:li>First Author</rdf:li><rdf:li>Second</rdf:li></rdf:Seq></dc:creator>
 *
 * Matches by namespace URI, not prefix, since producers pick their own prefixes.
 */
internal object XmpMetadataReader {
  private const val DC_NS = "http://purl.org/dc/elements/1.1/"
  private const val RDF_NS = "http://www.w3.org/1999/02/22-rdf-syntax-ns#"
  private const val XML_NS = "http://www.w3.org/XML/1998/namespace"

  class Result(val title: String?, val authors: List<String>)

  fun parse(packet: ByteArray): Result? {
    val doc = XmlSupport.parse(ByteArrayInputStream(packet)) ?: return null

    var title: String? = null
    val titleNodes = doc.getElementsByTagNameNS(DC_NS, "title")
    for (i in 0 until titleNodes.length) {
      title = languageAlternative(titleNodes.item(i) as Element)
      if (title != null) break
    }

    val authors = ArrayList<String>()
    val creatorNodes = doc.getElementsByTagNameNS(DC_NS, "creator")
    for (i in 0 until creatorNodes.length) {
      authors.addAll(listItems(creatorNodes.item(i) as Element))
      if (authors.isNotEmpty()) break // first dc:creator that has content
    }

    if (title == null && authors.isEmpty()) return null
    return Result(title, authors)
  }

  /** rdf:Alt of language variants: prefer x-default, else the first non-empty one. A property
   * with no rdf:li at all (`<dc:title>Plain</dc:title>`) is taken as is. */
  private fun languageAlternative(property: Element): String? {
    val items = property.getElementsByTagNameNS(RDF_NS, "li")
    if (items.length == 0) return property.textContent?.trim()?.ifEmpty { null }
    var first: String? = null
    for (i in 0 until items.length) {
      val li = items.item(i) as Element
      val text = li.textContent?.trim().orEmpty()
      if (text.isEmpty()) continue
      if (li.getAttributeNS(XML_NS, "lang").equals("x-default", ignoreCase = true)) return text
      if (first == null) first = text
    }
    return first
  }

  private fun listItems(property: Element): List<String> {
    val items = property.getElementsByTagNameNS(RDF_NS, "li")
    if (items.length == 0) return listOfNotNull(property.textContent?.trim()?.ifEmpty { null })
    return (0 until items.length)
        .map { (items.item(it) as Element).textContent?.trim().orEmpty() }
        .filter { it.isNotEmpty() }
  }
}
