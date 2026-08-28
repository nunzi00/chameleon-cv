// Plantilla base Typst de Chameleon CV (T-3.4, docs/typst-integration.md §4 y §8): la implementación de
// referencia de un CV de calidad editorial. Recibe la StructuredView (src/renderers/structured) ya
// decodificada: el Markdown en línea llega como «runs» (negrita, cursiva, código, enlace) y los
// párrafos y listas como «blocks». No interpreta Markdown, no lee ficheros ni importa paquetes: solo
// maqueta datos. La CLI genera el documento principal: `#import "/cv.typ": cv` y `#cv(json(bytes("…")))`.
//
// Para personalizarla: copia este fichero a tu directorio, edítalo y pásalo con
// `cv generate-cv --format pdf --engine typst -t mi-plantilla.typ` (contrato en docs/plantillas-typst.md).

// ── Paleta y escala ─────────────────────────────────────────────────────────────────────────────
#let ink = rgb("#1b1b1b")      // texto
#let muted = rgb("#5c5c5c")    // metadatos, etiquetas de sección
#let rule = rgb("#c9c9c9")     // reglas
#let accent = rgb("#1f4e79")   // enlaces

#let sizes = (
  name: 24pt,
  headline: 11.5pt,
  contact: 9.3pt,
  section: 9.4pt,
  title: 10.8pt,
  meta: 9.3pt,
  body: 10pt,
  footer: 8.5pt,
)

// ── Runs y bloques (Markdown ya descompuesto por la CLI) ────────────────────────────────────────
#let run(r) = {
  let body = if r.code { raw(r.text) } else { r.text }
  if r.bold { body = strong(body) }
  if r.italic { body = emph(body) }
  let url = r.at("link", default: none)
  if url != none { body = link(url, body) }
  body
}

#let runs(rs) = rs.map(run).join()

#let blocks(bs) = {
  for b in bs {
    if b.runs.len() > 0 {
      if b.bullet { list.item(runs(b.runs)) } else { par(runs(b.runs)) }
    }
  }
}

#let achievement(a) = {
  let impact = a.at("impact", default: none)
  let tail = if impact != none { text(fill: muted)[ (#impact)] } else { [] }
  list.item(runs(a.runs) + tail)
}

// ── Piezas de maquetación ───────────────────────────────────────────────────────────────────────
// Título de sección: versalitas espaciadas sobre una regla fina. Nunca queda huérfano al pie de página.
#let section(title) = block(
  width: 100%,
  above: 1.25em,
  below: 0.6em,
  sticky: true,
  inset: (bottom: 2.5pt),
  stroke: (bottom: 0.5pt + rule),
  text(size: sizes.section, weight: "semibold", fill: muted, tracking: 0.09em, smallcaps(title)),
)

// Cabecera de entrada: título a la izquierda, periodo a la derecha; ubicación debajo si la hay.
#let entry(heading, period, location: none) = {
  let cells = (
    text(size: sizes.title, weight: "semibold")[#heading],
    text(size: sizes.meta, fill: muted)[#period],
  )
  if location != none {
    cells.push(text(size: sizes.meta, fill: muted, style: "italic")[#location])
    cells.push([])
  }
  block(sticky: true, above: 0.95em, below: 0.4em, grid(columns: (1fr, auto), column-gutter: 1.2em, row-gutter: 0.4em, align: (left, right), ..cells))
}

#let technologies(label, names) = block(above: 0.5em, text(size: sizes.meta, fill: muted)[#text(weight: "semibold")[#label:] #names])

#let container(d, heading, subtitle, item, location: none) = {
  entry(heading, subtitle, location: location)
  blocks(item.summary)
  for a in item.achievements { achievement(a) }
  if item.technologies != "" { technologies(d.labels.technologies, item.technologies) }
}

// Fila «etiqueta: valor» con el valor alineado (skills, formación, certificaciones).
#let row(lhs, rhs) = grid(columns: (1fr, auto), column-gutter: 1.2em, align: (left, right), lhs, text(size: sizes.meta, fill: muted)[#rhs])

// ── Documento ───────────────────────────────────────────────────────────────────────────────────
#let cv(d) = {
  set document(title: "CV — " + d.fullName, author: d.fullName)
  set page(
    paper: "a4",
    margin: (x: 1.9cm, top: 1.7cm, bottom: 1.6cm),
    footer: context {
      let total = counter(page).final().first()
      if total > 1 {
        align(center, text(size: sizes.footer, fill: muted)[#d.fullName · #counter(page).display() / #total])
      }
    },
  )
  set text(font: "Source Sans 3", size: sizes.body, lang: d.lang, fill: ink, hyphenate: false)
  set strong(delta: 200) // Regular (400) → Semibold (600): las tres caras embebidas en templates/fonts
  set par(justify: false, leading: 0.55em, spacing: 0.7em)
  set list(marker: text(fill: muted)[•], indent: 0.1em, body-indent: 0.6em, spacing: 0.45em)
  show link: set text(fill: accent)
  show raw.where(block: false): set text(size: 9.2pt)

  // Cabecera
  block(below: 8pt, text(size: sizes.name, weight: "semibold", tracking: -0.01em)[#d.fullName])
  let headline = d.at("headline", default: none)
  if headline != none { block(below: 0.45em, text(size: sizes.headline, fill: muted)[#headline]) }
  if d.contact.len() > 0 { block(below: 0.7em, text(size: sizes.contact, fill: muted, runs(d.contact))) }
  line(length: 100%, stroke: 0.7pt + rule)
  if d.summary.len() > 0 { v(0.5em); blocks(d.summary) }

  if d.experience.len() > 0 {
    section(d.labels.experience)
    for item in d.experience {
      container(d, item.role + " · " + item.company, item.period, item, location: item.at("location", default: none))
    }
  }

  if d.projects.len() > 0 {
    section(d.labels.projects)
    for item in d.projects {
      let role = item.at("role", default: none)
      let heading = if role != none { item.name + " · " + role } else { item.name }
      container(d, heading, item.meta, item)
    }
  }

  if d.skillGroups.len() > 0 {
    section(d.labels.skills)
    grid(
      columns: (auto, 1fr),
      column-gutter: 1.2em,
      row-gutter: 0.45em,
      ..d.skillGroups.map(g => (text(weight: "semibold")[#g.label:], [#g.names])).flatten(),
    )
  }

  if d.achievements.len() > 0 {
    section(d.labels.achievements)
    for a in d.achievements { achievement(a) }
  }

  if d.education.len() > 0 {
    section(d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let degree = if field != none { e.degree + " (" + field + ")" } else { e.degree }
      block(below: 0.45em, row([#strong(degree) · #e.institution], e.period))
    }
  }

  if d.certifications.len() > 0 {
    section(d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      let left = [#strong(c.name)#if issuer != none [ · #issuer]#if url != none [ · #link(url)[#d.labels.link]]]
      block(below: 0.45em, row(left, c.date))
    }
  }

  if d.languages.len() > 0 {
    section(d.labels.languages)
    d.languages.map(l => [#strong(l.name): #l.level]).join([ · ])
  }
}
