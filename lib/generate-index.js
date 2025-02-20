'use strict'

const lunr = require('lunr')
const cheerio = require('cheerio')
const pako = require('pako')
const Entities = require('html-entities').AllHtmlEntities
const entities = new Entities()

/**
 * Generate a Lunr index.
 *
 * Iterates over the specified pages and creates a Lunr index.
 *
 * @memberof generate-index
 *
 * @param {Object} playbook - The configuration object for Antora.
 * @param {Object} playbook.site - Site-related configuration data.
 * @param {String} playbook.site.url - The base URL of the site.
 * @param {Array<File>} pages - The publishable pages to map.
 * @returns {Object} A JSON object with a Lunr index and a documents store.
 */
function generateIndex (playbook, pages) {
  let siteUrl = playbook.site.url
  if (!siteUrl) {
    // Uses relative links when site URL is not set
    siteUrl = ''
  }
  if (siteUrl.charAt(siteUrl.length - 1) === '/') siteUrl = siteUrl.substr(0, siteUrl.length - 1)
  if (!pages.length) return {}
  // Map of Lunr ref to document
  const documentsStore = {}
  const documents = pages.map((page) => {
    const html = page.contents.toString()
    const $ = cheerio.load(html)

    // Fetch just the article content, so we don't index the TOC and other on-page text
    // Remove any found headings, to improve search results
    const article = $('article.doc')
    const $h1 = $('h1', article)
    const documentTitle = $h1.text()
    $h1.remove()
    const titles = []
    $('h2,h3,h4,h5,h6', article).each(function () {
      let $title = $(this)
      // If the title does not have an Id then Lunr will throw a TypeError
      // cannot read property 'text' of undefined.
      if ($title.attr('id')) {
        titles.push({
          text: $title.text(),
          id: $title.attr('id')
        })
      }
      $title.remove()
    })

    // Pull the text from the article, and convert entities
    let text = article.text()
    // Decode HTML
    text = entities.decode(text)
    // Strip HTML tags
    text = text.replace(/(<([^>]+)>)/ig, '')
      .replace(/\n/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // Return the indexable content, organized by type
    return {
      text: text,
      title: documentTitle,
      component: page.src.component,
      version: page.src.version,
      name: page.src.stem,
      url: siteUrl + page.pub.url,
      titles: titles // TODO get title id to be able to use fragment identifier
    }
  })

  // Construct the lunr index from the composed content
  const lunrIndex = lunr(function () {
    const self = this
    self.ref('url')
    self.field('title', { boost: 10 })
    self.field('name')
    self.field('text')
    self.field('component')
    self.metadataWhitelist = ['position']
    documents.forEach(function (doc) {
      self.add(doc)
      doc.titles.forEach(function (title) {
        self.add({
          title: title.text,
          url: `${doc.url}#${title.id}`
        })
      }, self)
    }, self)
  })

  // Place all indexed documents into the store
  documents.forEach(function (doc) {
    documentsStore[doc.url] = doc
  })

  // Return the completed index, store, and component map
  return {
    index: lunrIndex,
    store: documentsStore
  }
}

// Helper function that converts a string into a buffer
function str2buffer (str) {
  const length = str.length
  const a16 = new Uint16Array(length)
  for (let i = 0; i < length; ++i) {
    a16[i] = str.charCodeAt(i)
  }
  return new Uint8Array(a16.buffer)
}

// Take the index and compress it
function compress (index) {
  return pako.deflate(str2buffer(JSON.stringify(index)))
}

// Helper function allowing Antora to create a site asset containing the index
function createIndexFile (index) {
  return {
    mediaType: 'application/gzip',
    contents: Buffer.from(compress(index)),
    src: { stem: 'search_index' },
    out: { path: 'search_index.json.gz' },
    pub: { url: '/search_index.json.gz', rootPath: '' }
  }
}

module.exports = generateIndex
module.exports.createIndexFile = createIndexFile
