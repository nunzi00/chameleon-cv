// Tema «tech» de Chameleon CV (T-8.7): híbrido «skills-first» con etiquetas monoespaciadas. Recibe la StructuredView
// (src/renderers/structured) ya decodificada y el tema (theme.toml). No interpreta Markdown, no lee ficheros ni
// importa paquetes: solo maqueta datos. La CLI genera el documento principal:
//   #import "/template.typ": cv
//   #cv(json(bytes("…vista…")), json(bytes("…tema…")))
// Contrato en docs/plantillas-typst.md. Las etiquetas son cajas en línea dentro del párrafo: pdf.js las lee en
// orden («TypeScript Kafka PostgreSQL»), sin ligaduras ni estilo de código (text(font: mono), no raw).

// ── Estilos derivados del tema ──────────────────────────────────────────────────────────────────
#let styles(theme) = (
  ink: rgb(theme.colors.text),
  primary: rgb(theme.colors.primary),
  muted: rgb(theme.colors.secondary),
  rule: rgb(theme.colors.rule),
  accent: rgb(theme.colors.accent),
  fonts: theme.fonts,
  sizes: (
    name: theme.sizes.name * 1pt,
    headline: theme.sizes.headline * 1pt,
    contact: theme.sizes.contact * 1pt,
    section: theme.sizes.section * 1pt,
    title: theme.sizes.title * 1pt,
    meta: theme.sizes.meta * 1pt,
    body: theme.sizes.body * 1pt,
    footer: theme.sizes.footer * 1pt,
    code: theme.sizes.code * 1pt,
  ),
  spacing: (
    leading: theme.spacing.leading * 1em,
    paragraph: theme.spacing.paragraph * 1em,
    list: theme.spacing.list * 1em,
  ),
  margins: (
    top: theme.page.margins.top * 1mm,
    right: theme.page.margins.right * 1mm,
    bottom: theme.page.margins.bottom * 1mm,
    left: theme.page.margins.left * 1mm,
  ),
  paper: theme.page.paper,
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

// En el contacto, los enlaces muestran su URL (sin esquema) en monoespaciada: lo que un técnico quiere ver.
#let contact-run(s, r) = {
  let url = r.at("link", default: none)
  if url == none { run(r) } else {
    let shown = url.replace("https://", "").replace("http://", "").trim("/", at: end)
    link(url, text(font: s.fonts.mono, size: s.sizes.code)[#shown])
  }
}

#let blocks(bs) = {
  for b in bs {
    if b.runs.len() > 0 {
      if b.bullet { list.item(runs(b.runs)) } else { par(runs(b.runs)) }
    }
  }
}

#let achievement(s, a) = {
  let impact = a.at("impact", default: none)
  let tail = if impact != none { text(fill: s.muted)[ (#impact)] } else { [] }
  list.item(runs(a.runs) + tail)
}

#let split-meta(meta) = {
  let parts = meta.split(" · ")
  (period: parts.first(), rest: if parts.len() > 1 { parts.slice(1).join(" · ") } else { none })
}

// ── Etiquetas ───────────────────────────────────────────────────────────────────────────────────
#let pill(s, t) = box(fill: s.rule, radius: 3pt, inset: (x: 4.5pt, y: 2pt), baseline: 20%, text(font: s.fonts.mono, size: s.sizes.code, fill: s.ink)[#t])

// «PHP 8.3, Kafka, PostgreSQL» → etiquetas separadas por un pequeño espacio, en un párrafo (fluyen y se parten).
#let pills(s, names) = par(leading: 0.9em, names.split(", ").filter(n => n.trim() != "").map(n => pill(s, n.trim())).join(h(3.5pt)))

// ── Piezas de maquetación ───────────────────────────────────────────────────────────────────────
#let section(s, title) = block(
  width: 100%,
  above: 1.25em,
  below: 0.6em,
  sticky: true,
  inset: (bottom: 2.5pt),
  stroke: (bottom: 0.7pt + s.accent),
  text(font: s.fonts.heading, size: s.sizes.section, weight: "bold", fill: s.primary)[#title],
)

// Cabecera de entrada: título a la izquierda, periodo en monoespaciada a la derecha; ubicación o URL debajo.
#let entry(s, heading, period, location: none) = {
  let cells = (
    text(font: s.fonts.heading, size: s.sizes.title, weight: "bold", fill: s.primary)[#heading],
    text(font: s.fonts.mono, size: s.sizes.code, fill: s.muted)[#period],
  )
  if location != none {
    cells.push(text(size: s.sizes.meta, fill: s.muted)[#location])
    cells.push([])
  }
  block(sticky: true, above: 0.95em, below: 0.35em, grid(columns: (1fr, auto), column-gutter: 1.2em, row-gutter: 0.3em, align: (left, right), ..cells))
}

#let container(s, d, heading, period, item, location: none) = {
  entry(s, heading, period, location: location)
  blocks(item.summary)
  for a in item.achievements { achievement(s, a) }
  if item.technologies != "" {
    block(above: 0.45em, [#text(size: s.sizes.meta, fill: s.muted, weight: "semibold")[#d.labels.technologies:] #pills(s, item.technologies)])
  }
}

#let row(s, lhs, rhs) = grid(columns: (1fr, auto), column-gutter: 1.2em, align: (left, right), lhs, text(font: s.fonts.mono, size: s.sizes.code, fill: s.muted)[#rhs])

// ── Documento ───────────────────────────────────────────────────────────────────────────────────
#let cv(d, theme) = {
  let s = styles(theme)
  set document(title: "CV — " + d.fullName, author: d.fullName)
  set page(
    paper: s.paper,
    margin: s.margins,
    footer: context {
      let total = counter(page).final().first()
      if total > 1 {
        align(center, text(size: s.sizes.footer, fill: s.muted)[#d.fullName · #counter(page).display() / #total])
      }
    },
  )
  set text(font: s.fonts.body, size: s.sizes.body, lang: d.lang, fill: s.ink, hyphenate: false)
  set strong(delta: 200)
  set par(justify: false, leading: s.spacing.leading, spacing: s.spacing.paragraph)
  set list(marker: text(fill: s.accent)[•], indent: 0.1em, body-indent: 0.6em, spacing: s.spacing.list)
  show link: set text(fill: s.accent)
  show raw.where(block: false): set text(font: s.fonts.mono, size: s.sizes.code)

  // Cabecera: nombre, titular y contacto con las URL a la vista.
  block(below: 6pt, text(font: s.fonts.heading, size: s.sizes.name, weight: "bold", fill: s.primary, tracking: -0.01em)[#d.fullName])
  let headline = d.at("headline", default: none)
  if headline != none { block(below: 0.45em, text(size: s.sizes.headline, fill: s.muted)[#headline]) }
  if d.contact.len() > 0 { block(below: 0.7em, text(size: s.sizes.contact, fill: s.muted, d.contact.map(r => contact-run(s, r)).join())) }
  if d.summary.len() > 0 { blocks(d.summary) }

  // Habilidades primero: etiqueta de categoría y sus nombres como etiquetas.
  if d.skillGroups.len() > 0 {
    section(s, d.labels.skills)
    grid(
      columns: (auto, 1fr),
      column-gutter: 1em,
      row-gutter: 0.55em,
      align: (left + top, left + top),
      ..d.skillGroups.map(g => (text(weight: "semibold", size: s.sizes.meta, fill: s.muted)[#g.label], pills(s, g.names))).flatten(),
    )
  }

  if d.experience.len() > 0 {
    section(s, d.labels.experience)
    for item in d.experience {
      container(s, d, item.role + " · " + item.company, item.period, item, location: item.at("location", default: none))
    }
  }

  if d.projects.len() > 0 {
    section(s, d.labels.projects)
    for item in d.projects {
      let meta = split-meta(item.meta)
      let role = item.at("role", default: none)
      let heading = if role != none { item.name + " · " + role } else { item.name }
      let url = if meta.rest != none { link(meta.rest, text(font: s.fonts.mono, size: s.sizes.code)[#meta.rest.replace("https://", "").replace("http://", "")]) } else { none }
      container(s, d, heading, meta.period, item, location: url)
    }
  }

  if d.achievements.len() > 0 {
    section(s, d.labels.achievements)
    for a in d.achievements { achievement(s, a) }
  }

  if d.education.len() > 0 {
    section(s, d.labels.education)
    for e in d.education {
      let field = e.at("field", default: none)
      let degree = if field != none { e.degree + " (" + field + ")" } else { e.degree }
      block(below: 0.45em, row(s, [#strong(degree) · #e.institution], e.period))
    }
  }

  if d.certifications.len() > 0 {
    section(s, d.labels.certifications)
    for c in d.certifications {
      let issuer = c.at("issuer", default: none)
      let url = c.at("url", default: none)
      let left = [#strong(c.name)#if issuer != none [ · #issuer]#if url != none [ · #link(url)[#d.labels.link]]]
      block(below: 0.45em, row(s, left, c.date))
    }
  }

  if d.languages.len() > 0 {
    section(s, d.labels.languages)
    d.languages.map(l => [#strong(l.name): #l.level]).join([ · ])
  }
}
