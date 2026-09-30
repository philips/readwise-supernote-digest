package com.plugin.docmeta

import java.io.InputStream
import javax.xml.parsers.DocumentBuilderFactory
import org.xml.sax.InputSource

/** Namespace-aware, hardened XML parsing shared by the EPUB (OPF) and PDF (XMP) readers. */
internal object XmlSupport {
  /** Null on malformed input; never fetches anything, whatever the document's DOCTYPE says. */
  fun parse(stream: InputStream): org.w3c.dom.Document? {
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
    builder.setEntityResolver { _, _ -> InputSource(java.io.StringReader("")) }
    return try {
      builder.parse(stream)
    } catch (_: Exception) {
      null
    }
  }
}
